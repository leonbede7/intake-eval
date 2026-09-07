export const categories = ['billing', 'technical', 'account', 'other'] as const;
export const priorities = ['normal', 'urgent'] as const;
export type Category = (typeof categories)[number];
export type Priority = (typeof priorities)[number];

export interface TriageCandidate {
  summary: string;
  category: Category;
  priority: Priority;
  evidence: string[];
}

export interface Issue {
  code: 'INVALID_SOURCE' | 'INVALID_JSON' | 'INVALID_SCHEMA' | 'UNGROUNDED_EVIDENCE';
  path: string;
  message: string;
}

export type ReviewResult =
  | { decision: 'rejected'; issues: Issue[] }
  | {
      decision: 'review_required';
      candidate: TriageCandidate;
      queue: 'standard' | 'escalation';
      reasons: string[];
      issues: [];
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Quotes use exact, case-sensitive matching. No Unicode or whitespace rewriting. */
export function reviewCandidate(source: unknown, rawCandidate: unknown): ReviewResult {
  if (typeof source !== 'string' || source.trim().length === 0 || source.length > 20_000) {
    return { decision: 'rejected', issues: [{ code: 'INVALID_SOURCE', path: 'source', message: 'Source must contain 1–20,000 characters and cannot be blank.' }] };
  }

  let value: unknown = rawCandidate;
  if (typeof value === 'string') {
    if (value.length > 20_000) {
      return { decision: 'rejected', issues: [{ code: 'INVALID_JSON', path: 'candidate', message: 'Candidate exceeds 20,000 characters.' }] };
    }
    try { value = JSON.parse(value); }
    catch { return { decision: 'rejected', issues: [{ code: 'INVALID_JSON', path: 'candidate', message: 'Candidate must be valid JSON without Markdown fences.' }] }; }
  }

  if (!isRecord(value)) {
    return { decision: 'rejected', issues: [{ code: 'INVALID_SCHEMA', path: 'candidate', message: 'Candidate must be an object.' }] };
  }

  const issues: Issue[] = [];
  const schemaIssue = (path: string, message: string) => issues.push({ code: 'INVALID_SCHEMA', path, message });
  const allowed = new Set(['summary', 'category', 'priority', 'evidence']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) schemaIssue(`candidate.${key}`, 'Unexpected field.');
  }
  if (typeof value.summary !== 'string' || value.summary.trim().length < 5 || value.summary.length > 280) {
    schemaIssue('candidate.summary', 'Summary must contain 5–280 characters and cannot be blank.');
  }
  if (!categories.includes(value.category as Category)) schemaIssue('candidate.category', 'Unknown category.');
  if (!priorities.includes(value.priority as Priority)) schemaIssue('candidate.priority', 'Unknown priority.');
  if (!Array.isArray(value.evidence) || value.evidence.length === 0 || value.evidence.length > 5) {
    schemaIssue('candidate.evidence', 'Provide 1–5 evidence quotes.');
  } else {
    const seen = new Set<string>();
    value.evidence.forEach((quote: unknown, index: number) => {
      const path = `candidate.evidence[${index}]`;
      if (typeof quote !== 'string' || quote.trim().length < 8 || quote.length > 500) {
        schemaIssue(path, 'Each quote must contain 8–500 characters.');
      } else if (seen.has(quote)) {
        schemaIssue(path, 'Duplicate evidence quote.');
      } else {
        seen.add(quote);
        if (!source.includes(quote)) issues.push({ code: 'UNGROUNDED_EVIDENCE', path, message: 'Quote does not occur exactly in the supplied source.' });
      }
    });
  }
  if (issues.length > 0) return { decision: 'rejected', issues };

  const candidate = value as unknown as TriageCandidate;
  // Route on source signals too, so a candidate cannot hide these by choosing normal.
  // This deliberately favors human review and does not infer actual incident severity.
  const sourceEscalation = /\b(refund|chargeback|fraud|security|breach|lawsuit|legal)\b/i.test(source);
  const reasons = ['A person must verify the summary, category, and priority before any action.'];
  if (sourceEscalation) reasons.push('Source contains an English financial, security, or legal escalation keyword.');
  if (candidate.priority === 'urgent') reasons.push('Candidate requests urgent review.');
  return {
    decision: 'review_required',
    candidate: { ...candidate, evidence: [...candidate.evidence] },
    queue: sourceEscalation || candidate.priority === 'urgent' ? 'escalation' : 'standard',
    reasons,
    issues: [],
  };
}
