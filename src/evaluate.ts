import { reviewCandidate } from './triage.ts';
import type { Issue } from './triage.ts';

export interface EvaluationCase {
  id: string;
  source: unknown;
  candidate: unknown;
  expected: {
    decision: 'rejected' | 'review_required';
    queue?: 'standard' | 'escalation';
    issueCodes?: Issue['code'][];
  };
}

/** Fixtures are supplied as data; never execute model output or fixture content. */
export function parseCases(value: unknown): EvaluationCase[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000)
    throw new Error('Expected an array of 1–1,000 evaluation cases.');
  const ids = new Set<string>();
  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof entry.id !== 'string' ||
      !entry.id.trim() ||
      ids.has(entry.id)
    ) {
      throw new Error('Every case needs a unique, nonempty string id.');
    }
    ids.add(entry.id);
    if (!Object.hasOwn(entry, 'source') || !Object.hasOwn(entry, 'candidate'))
      throw new Error(`Missing source or candidate in ${entry.id}.`);
    const expected = entry.expected;
    if (
      !expected ||
      typeof expected !== 'object' ||
      Array.isArray(expected) ||
      !['rejected', 'review_required'].includes(expected.decision)
    ) {
      throw new Error(`Invalid expected decision in ${entry.id}.`);
    }
    if (Object.keys(expected).some((key) => !['decision', 'queue', 'issueCodes'].includes(key)))
      throw new Error(`Unknown expectation field in ${entry.id}.`);
    if (
      expected.decision === 'review_required' &&
      !['standard', 'escalation'].includes(expected.queue)
    )
      throw new Error(`Review case ${entry.id} needs an expected queue.`);
    if (expected.decision === 'rejected' && Object.hasOwn(expected, 'queue'))
      throw new Error(`Rejected case ${entry.id} cannot have a queue.`);
    if (
      expected.issueCodes !== undefined &&
      (!Array.isArray(expected.issueCodes) ||
        expected.issueCodes.some(
          (code: unknown) =>
            !['INVALID_SOURCE', 'INVALID_JSON', 'INVALID_SCHEMA', 'UNGROUNDED_EVIDENCE'].includes(
              code as string,
            ),
        ))
    ) {
      throw new Error(`Invalid issueCodes in ${entry.id}.`);
    }
    if (expected.decision === 'review_required' && expected.issueCodes?.length)
      throw new Error(`Review case ${entry.id} cannot expect issues.`);
  }
  return value as EvaluationCase[];
}

export function evaluate(cases: EvaluationCase[]) {
  const results = cases.map((testCase) => {
    const result = reviewCandidate(testCase.source, testCase.candidate);
    const codes = [...new Set(result.issues.map((issue) => issue.code))].sort();
    const expectedCodes = testCase.expected.issueCodes;
    const passed =
      result.decision === testCase.expected.decision &&
      (testCase.expected.queue === undefined ||
        (result.decision === 'review_required' && result.queue === testCase.expected.queue)) &&
      (expectedCodes === undefined ||
        JSON.stringify(codes) === JSON.stringify([...new Set(expectedCodes)].sort()));
    // Report only case labels and outcomes, never raw customer text or model summaries.
    return {
      id: testCase.id,
      passed,
      decision: result.decision,
      queue: result.decision === 'review_required' ? result.queue : null,
      issueCodes: codes,
    };
  });
  return {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    results,
  };
}
