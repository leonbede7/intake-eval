import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  createReviewSession,
  beginReview,
  finishReview,
  parseReviewSession,
  reviewSummary,
  reviewDatasetId,
} from '../src/human-review.ts';
import type { ReviewDataset, ReviewEntry } from '../src/human-review.ts';
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const captures = read('../docs/results/routing-comparison/v2/candidates.json') as {
  id: string;
  output: string;
}[];
const samples = (read('../fixtures/routing-comparison.json') as ReviewDataset['samples']).map(
  ({ id, source, language, expected }) => ({
    id,
    source,
    language,
    expected,
    candidate: captures.find((c) => c.id === id)!.output,
  }),
);
const data: ReviewDataset = {
  id: reviewDatasetId,
  hash: createHash('sha256')
    .update(JSON.stringify({ id: reviewDatasetId, samples }))
    .digest('hex'),
  samples,
};
const first = data.samples[0]!;
const now = '2026-09-09T08:00:00.000Z';
function assessed(): ReviewEntry {
  const row = createReviewSession(data, now).entries[0]!;
  row.draft = { ...row.draft, category: 'other', priority: 'normal', escalation: 'unsure' };
  return beginReview(row, now);
}
function complete(): ReviewEntry {
  const row = assessed();
  row.draft = {
    ...row.draft,
    category: 'billing',
    summary: 'unclear',
    disposition: 'unresolved',
    notes: 'Cannot confidently judge the summary.',
  };
  return finishReview(row, first, now);
}
test('new sessions contain no invented judgments and require a complete initial assessment', () => {
  const s = createReviewSession(data, now);
  assert.ok(s.entries.every((e) => e.initial === null && e.revisions.length === 0));
  assert.throws(() => beginReview(s.entries[0]!), /all three/);
  assert.throws(() => finishReview(s.entries[0]!, first), /initial assessment/);
});
test('initial assessment is immutable through later revisions', () => {
  const row = complete();
  assert.equal(row.initial!.category, 'other');
  assert.equal(row.revisions[0]!.category, 'billing');
  assert.throws(() => beginReview(row), /already saved/);
  const next = finishReview(
    { ...row, draft: { ...row.draft, notes: 'Second assessment.' } },
    first,
    '2026-09-09T09:00:00.000Z',
  );
  assert.deepEqual(next.initial, row.initial);
  assert.equal(next.revisions.length, 2);
  assert.equal(next.revisions[0]!.notes, 'Cannot confidently judge the summary.');
});
test('corrections and uncertainty require reasons; acceptable cannot hide a bad summary', () => {
  const row = assessed();
  row.draft = { ...row.draft, summary: 'inaccurate', disposition: 'needs_correction', notes: '  ' };
  assert.throws(() => finishReview(row, first), /short reason/);
  row.draft.disposition = 'unresolved';
  assert.throws(() => finishReview(row, first), /short reason/);
  row.draft.disposition = 'acceptable';
  assert.throws(() => finishReview(row, first), /accurate summary/);
});
test('an acceptable review must agree with a valid candidate', () => {
  const row = assessed();
  const candidate = JSON.parse(first.candidate);
  row.draft = {
    category: candidate.category,
    priority: candidate.priority,
    escalation: candidate.reviewReason === 'none' ? 'no' : 'yes',
    summary: 'accurate',
    disposition: 'acceptable',
    notes: '',
  };
  assert.equal(finishReview(row, first).revisions.length, 1);
  assert.throws(() => finishReview(row, { ...first, candidate: '{}' }), /rejected candidate/);
});
test('export and import round trip preserves drafts, initial assessments and history', () => {
  const s = createReviewSession(data, now);
  s.entries[0] = complete();
  s.reviewer = { label: 'Leon', relationship: 'project_author' };
  s.entries[1]!.draft.priority = 'urgent';
  const roundtrip = parseReviewSession(JSON.parse(JSON.stringify(s)), data);
  assert.deepEqual(roundtrip, s);
  roundtrip.entries[0]!.draft.notes = 'changed';
  assert.notDeepEqual(roundtrip, s);
});
for (const kind of [
  'version',
  'hash',
  'id',
  'duplicate',
  'missing',
  'extra',
  'invalid enum',
  'invalid date',
  'invalid revision',
  'unknown property',
  'long label',
  'long notes',
  'unassessed revision',
] as const) {
  test(`import rejects ${kind} without changing existing state`, () => {
    const original = createReviewSession(data, now);
    original.entries[0] = complete();
    const v = JSON.parse(JSON.stringify(original));
    if (kind === 'version') v.version = 2;
    if (kind === 'hash') v.dataset.hash = 'changed';
    if (kind === 'id') v.dataset.id = 'another-set';
    if (kind === 'duplicate') v.entries[1] = v.entries[0];
    if (kind === 'missing') v.entries.pop();
    if (kind === 'extra') v.entries.push(v.entries[0]);
    if (kind === 'invalid enum') v.entries[0].draft.category = 'invented';
    if (kind === 'invalid date') v.savedAt = '2026-02-30T00:00:00.000Z';
    if (kind === 'invalid revision') v.entries[0].revisions[0].notes = '';
    if (kind === 'unknown property') v.execute = 'something';
    if (kind === 'long label') v.reviewer.label = 'x'.repeat(81);
    if (kind === 'long notes') v.entries[0].draft.notes = 'x'.repeat(2001);
    if (kind === 'unassessed revision') v.entries[0].initial = null;
    assert.throws(() => parseReviewSession(v, data), /Invalid review file/);
    assert.equal(original.entries[0]!.initial!.category, 'other');
  });
}
test('summary denominators count saved reviews, exclude uncertainty and retain distinct assessment bases', () => {
  const s = createReviewSession(data, now);
  assert.equal(reviewSummary(s, data).completed, 0);
  s.entries[0] = complete();
  const result = reviewSummary(s, data);
  assert.equal(result.completed, 1);
  assert.equal(result.unresolved, 1);
  assert.equal(result.summaries.unclear, 1);
  const escalation = result.comparisons.filter((r) => r.field === 'escalation');
  assert.ok(escalation.every((r) => r.denominator === 0 && r.excluded === 1));
  assert.ok(
    result.comparisons.filter((r) => r.field === 'category').every((r) => r.denominator === 1),
  );
  s.entries[0]!.draft.summary = 'accurate';
  assert.equal(reviewSummary(s, data).summaries.unclear, 1, 'unsaved edits must not change totals');
});
