import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewCandidateV2 } from '../src/triage-v2.ts';
import { messagesFor, promptMetadata } from '../src/prompt.ts';

const source = 'Ne tražim povrat novca. Trebam samo presliku računa.';
const candidate = () => ({
  summary: 'Customer asks for an invoice copy, not a refund.',
  category: 'billing',
  priority: 'normal',
  evidence: ['Trebam samo presliku računa.'],
  reviewReason: 'none',
  reviewEvidence: null,
});

test('v2 no longer escalates merely because a negated refund keyword exists', () => {
  const result = reviewCandidateV2(source, candidate());
  assert.equal(result.decision, 'review_required');
  if (result.decision === 'review_required') assert.equal(result.queue, 'standard');
});
test('normal-priority Croatian financial action receives specialist review', () => {
  const input = 'Vratite nam drugu uplatu, molim vas.';
  const result = reviewCandidateV2(input, {
    ...candidate(),
    evidence: [input],
    reviewReason: 'financial_action',
    reviewEvidence: input,
  });
  assert.equal(result.decision, 'review_required');
  if (result.decision === 'review_required') assert.equal(result.queue, 'escalation');
});
test('urgent priority still escalates even with no specialist reason', () => {
  const result = reviewCandidateV2(source, { ...candidate(), priority: 'urgent' });
  assert.equal(result.decision, 'review_required');
  if (result.decision === 'review_required') assert.equal(result.queue, 'escalation');
});
test('v2 refuses missing, unsupported and ungrounded review metadata', () => {
  const { reviewReason, ...missing } = candidate();
  for (const value of [
    missing,
    { ...candidate(), reviewReason: 'automatic_refund' },
    { ...candidate(), reviewEvidence: source },
    {
      ...candidate(),
      reviewReason: 'financial_action',
      reviewEvidence: 'A completely invented statement',
    },
  ]) {
    assert.equal(reviewCandidateV2(source, value).decision, 'rejected');
  }
});
test('v2 retains core quote validation and rejects unexpected action fields', () => {
  assert.equal(
    reviewCandidateV2(source, { ...candidate(), evidence: ['Invented quotation here'] }).decision,
    'rejected',
  );
  assert.equal(
    reviewCandidateV2(source, { ...candidate(), execute: 'refund' }).decision,
    'rejected',
  );
});
test('v2 preserves the limitation: literal evidence cannot verify the semantic reason', () => {
  const result = reviewCandidateV2(source, {
    ...candidate(),
    reviewReason: 'financial_action',
    reviewEvidence: 'Ne tražim povrat novca.',
  });
  assert.equal(result.decision, 'review_required');
  // A model can misinterpret a negated quote. Human review is never bypassed.
  if (result.decision === 'review_required') assert.match(result.reasons[0]!, /verify/);
});
test('v1 prompt metadata stays stable and v2 has a different contract', () => {
  assert.equal(
    promptMetadata('v1').sha256,
    'cab035aee17bba5b05989c232e9b93d4d4423327ada7f689404f350fcef01281',
  );
  assert.notEqual(promptMetadata('v1').sha256, promptMetadata('v2').sha256);
  assert.match(messagesFor(source, 'v2')[0]!.content, /reviewReason/);
});
