import { categories, priorities } from './triage.ts';
import type { Category, Priority } from './triage.ts';
import { reviewCandidateV2 } from './triage-v2.ts';

export const reviewDatasetId = 'routing-comparison-v2-human-review-1';
export const unsure = 'unsure' as const;
export const summaryRatings = ['accurate', 'partly_accurate', 'inaccurate', 'unclear'] as const;
export const dispositions = ['acceptable', 'needs_correction', 'unresolved'] as const;
export interface ReviewSample {
  id: string;
  source: string;
  language: 'en' | 'hr';
  expected: { category: Category; priority: Priority; escalation: boolean };
  candidate: string;
}
export interface ReviewDataset {
  id: string;
  hash: string;
  samples: ReviewSample[];
}
export interface Assessment {
  category: Category | typeof unsure;
  priority: Priority | typeof unsure;
  escalation: 'yes' | 'no' | typeof unsure;
}
export interface FinalReview extends Assessment {
  summary: (typeof summaryRatings)[number];
  disposition: (typeof dispositions)[number];
  notes: string;
  savedAt: string;
}
export interface ReviewDraft {
  category: Assessment['category'] | '';
  priority: Assessment['priority'] | '';
  escalation: Assessment['escalation'] | '';
  summary: FinalReview['summary'] | '';
  disposition: FinalReview['disposition'] | '';
  notes: string;
}
export interface ReviewEntry {
  id: string;
  initial: (Assessment & { savedAt: string }) | null;
  revisions: FinalReview[];
  draft: ReviewDraft;
}
export interface ReviewSession {
  version: 1;
  dataset: { id: string; hash: string };
  reviewer: { label: string; relationship: 'project_author' | 'visitor' };
  savedAt: string;
  entries: ReviewEntry[];
}
export const blankDraft = (): ReviewDraft => ({
  category: '',
  priority: '',
  escalation: '',
  summary: '',
  disposition: '',
  notes: '',
});
export function createReviewSession(
  dataset: ReviewDataset,
  now = new Date().toISOString(),
): ReviewSession {
  return {
    version: 1,
    dataset: { id: dataset.id, hash: dataset.hash },
    reviewer: { label: '', relationship: 'visitor' },
    savedAt: now,
    entries: dataset.samples.map(({ id }) => ({
      id,
      initial: null,
      revisions: [],
      draft: blankDraft(),
    })),
  };
}
export function assessmentComplete(value: ReviewDraft): value is ReviewDraft & Assessment {
  return (
    [...categories, unsure].includes(value.category as Assessment['category']) &&
    [...priorities, unsure].includes(value.priority as Assessment['priority']) &&
    ['yes', 'no', unsure].includes(value.escalation)
  );
}
export function beginReview(entry: ReviewEntry, now = new Date().toISOString()): ReviewEntry {
  if (entry.initial) throw new Error('The initial assessment is already saved.');
  if (!assessmentComplete(entry.draft))
    throw new Error('Choose all three assessments. Not sure is a valid choice.');
  const { category, priority, escalation } = entry.draft;
  return { ...entry, initial: { category, priority, escalation, savedAt: now } };
}
export function finalReviewError(entry: ReviewEntry, sample: ReviewSample): string | null {
  const d = entry.draft;
  if (!entry.initial) return 'Save an initial assessment first.';
  if (!assessmentComplete(d) || !d.summary || !d.disposition)
    return 'Complete all five review fields. Not sure and unclear are valid choices.';
  if (d.notes.length > 2000) return 'Keep notes within 2,000 characters.';
  if (d.disposition !== 'acceptable' && !d.notes.trim())
    return 'Add a short reason for a correction or unresolved review.';
  if (d.disposition === 'acceptable') {
    const result = reviewCandidateV2(sample.source, sample.candidate);
    if (result.decision === 'rejected') return 'A rejected candidate cannot be marked acceptable.';
    if (
      d.summary !== 'accurate' ||
      d.category !== result.candidate.category ||
      d.priority !== result.candidate.priority ||
      d.escalation !== (result.queue === 'escalation' ? 'yes' : 'no')
    )
      return 'Acceptable requires an accurate summary and agreement with the candidate on all three assessments. Otherwise choose needs correction or unresolved.';
  }
  if (entry.revisions.length >= 50)
    return 'This case has reached its 50-revision limit. Export your work before starting another session.';
  return null;
}
export function finishReview(
  entry: ReviewEntry,
  sample: ReviewSample,
  now = new Date().toISOString(),
): ReviewEntry {
  const error = finalReviewError(entry, sample);
  if (error) throw new Error(error);
  return {
    ...entry,
    revisions: [...entry.revisions, { ...entry.draft, savedAt: now } as FinalReview],
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: unknown, names: string[]): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === names.length &&
    names.every((k) => Object.hasOwn(value, k))
  );
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function assessment(value: Record<string, unknown>, empty = false) {
  return (
    [...categories, unsure, ...(empty ? [''] : [])].includes(value.category as string) &&
    [...priorities, unsure, ...(empty ? [''] : [])].includes(value.priority as string) &&
    ['yes', 'no', unsure, ...(empty ? [''] : [])].includes(value.escalation as string)
  );
}
const draftKeys = ['category', 'priority', 'escalation', 'summary', 'disposition', 'notes'];
/** Imports are user-supplied observations, not authenticated evidence of who reviewed them. */
export function parseReviewSession(value: unknown, dataset: ReviewDataset): ReviewSession {
  const fail = (): never => {
    throw new Error(
      'Invalid review file. Check its version, fields and dataset fingerprint. Your current work was not replaced.',
    );
  };
  if (
    !keys(value, ['version', 'dataset', 'reviewer', 'savedAt', 'entries']) ||
    value.version !== 1 ||
    !timestamp(value.savedAt)
  )
    return fail();
  if (
    !keys(value.dataset, ['id', 'hash']) ||
    value.dataset.id !== dataset.id ||
    value.dataset.hash !== dataset.hash
  )
    return fail();
  if (
    !keys(value.reviewer, ['label', 'relationship']) ||
    typeof value.reviewer.label !== 'string' ||
    value.reviewer.label.length > 80 ||
    !['visitor', 'project_author'].includes(value.reviewer.relationship as string)
  )
    return fail();
  if (!Array.isArray(value.entries) || value.entries.length !== dataset.samples.length)
    return fail();
  const ids = new Set<string>();
  for (const row of value.entries) {
    if (
      !keys(row, ['id', 'initial', 'revisions', 'draft']) ||
      typeof row.id !== 'string' ||
      ids.has(row.id)
    )
      return fail();
    const sample = dataset.samples.find((s) => s.id === row.id);
    if (!sample) return fail();
    ids.add(row.id);
    if (
      row.initial !== null &&
      (!keys(row.initial, ['category', 'priority', 'escalation', 'savedAt']) ||
        !assessment(row.initial) ||
        !timestamp(row.initial.savedAt))
    )
      return fail();
    if (
      !keys(row.draft, draftKeys) ||
      !assessment(row.draft, true) ||
      !['', ...summaryRatings].includes(row.draft.summary as string) ||
      !['', ...dispositions].includes(row.draft.disposition as string) ||
      typeof row.draft.notes !== 'string' ||
      row.draft.notes.length > 2000
    )
      return fail();
    if (
      !Array.isArray(row.revisions) ||
      row.revisions.length > 50 ||
      (!row.initial && row.revisions.length)
    )
      return fail();
    for (const revision of row.revisions) {
      if (
        !keys(revision, [...draftKeys, 'savedAt']) ||
        !assessment(revision) ||
        !summaryRatings.includes(revision.summary as FinalReview['summary']) ||
        !dispositions.includes(revision.disposition as FinalReview['disposition']) ||
        typeof revision.notes !== 'string' ||
        !timestamp(revision.savedAt)
      )
        return fail();
      if (
        finalReviewError(
          {
            id: row.id,
            initial: row.initial as ReviewEntry['initial'],
            revisions: [],
            draft: revision as unknown as ReviewDraft,
          },
          sample,
        )
      )
        return fail();
    }
    if (!row.initial && (row.draft.summary || row.draft.disposition || row.draft.notes))
      return fail();
  }
  return structuredClone(value) as unknown as ReviewSession;
}
export function reviewSummary(session: ReviewSession, dataset: ReviewDataset) {
  const completed = session.entries.filter((e) => e.revisions.length);
  const result = {
    total: session.entries.length,
    completed: completed.length,
    unresolved: 0,
    needsCorrection: 0,
    acceptable: 0,
    summaries: Object.fromEntries(summaryRatings.map((r) => [r, 0])) as Record<
      FinalReview['summary'],
      number
    >,
    comparisons: [] as {
      basis: 'initial' | 'final';
      target: 'model' | 'provisional';
      field: keyof Assessment;
      agree: number;
      disagree: number;
      denominator: number;
      excluded: number;
    }[],
  };
  for (const entry of completed) {
    const final = entry.revisions.at(-1)!;
    result.summaries[final.summary]++;
    if (final.disposition === 'unresolved') result.unresolved++;
    else if (final.disposition === 'acceptable') result.acceptable++;
    else result.needsCorrection++;
  }
  for (const basis of ['initial', 'final'] as const)
    for (const target of ['model', 'provisional'] as const)
      for (const field of ['category', 'priority', 'escalation'] as const) {
        let agree = 0,
          disagree = 0,
          excluded = 0;
        for (const entry of completed) {
          const human = basis === 'initial' ? entry.initial! : entry.revisions.at(-1)!;
          const sample = dataset.samples.find((s) => s.id === entry.id)!;
          const validation = reviewCandidateV2(sample.source, sample.candidate);
          const comparison =
            target === 'provisional'
              ? { ...sample.expected, escalation: sample.expected.escalation ? 'yes' : 'no' }
              : validation.decision === 'rejected'
                ? null
                : {
                    ...validation.candidate,
                    escalation: validation.queue === 'escalation' ? 'yes' : 'no',
                  };
          if (human[field] === unsure || !comparison) excluded++;
          else if (human[field] === comparison[field]) agree++;
          else disagree++;
        }
        result.comparisons.push({
          basis,
          target,
          field,
          agree,
          disagree,
          denominator: agree + disagree,
          excluded,
        });
      }
  return result;
}
