import { reviewCandidate } from './triage.ts';
import type { Issue, TriageCandidate } from './triage.ts';

export const reviewReasons = [
  'none',
  'financial_action',
  'security_incident',
  'legal_dispute',
] as const;
export type ReviewReason = (typeof reviewReasons)[number];
export interface TriageCandidateV2 extends TriageCandidate {
  reviewReason: ReviewReason;
  reviewEvidence: string | null;
}
export type ReviewResultV2 =
  | { decision: 'rejected'; issues: Issue[] }
  | {
      decision: 'review_required';
      candidate: TriageCandidateV2;
      queue: 'standard' | 'escalation';
      reasons: string[];
      issues: [];
    };

/** V2 separates incident priority from a quoted need for specialist review. */
export function reviewCandidateV2(source: unknown, raw: unknown): ReviewResultV2 {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > 20_000)
      return {
        decision: 'rejected',
        issues: [
          {
            code: 'INVALID_JSON',
            path: 'candidate',
            message: 'Candidate exceeds 20,000 characters.',
          },
        ],
      };
    try {
      value = JSON.parse(raw);
    } catch {
      return {
        decision: 'rejected',
        issues: [
          { code: 'INVALID_JSON', path: 'candidate', message: 'Candidate must be valid JSON.' },
        ],
      };
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return {
      decision: 'rejected',
      issues: [
        { code: 'INVALID_SCHEMA', path: 'candidate', message: 'Candidate must be an object.' },
      ],
    };
  const { reviewReason, reviewEvidence, ...core } = value as Record<string, unknown>;
  const base = reviewCandidate(source, core);
  if (base.decision === 'rejected') return base;
  const issues: Issue[] = [];
  if (!reviewReasons.includes(reviewReason as ReviewReason))
    issues.push({
      code: 'INVALID_SCHEMA',
      path: 'candidate.reviewReason',
      message: 'Choose a supported specialist-review reason.',
    });
  if (reviewReason === 'none') {
    if (reviewEvidence !== null)
      issues.push({
        code: 'INVALID_SCHEMA',
        path: 'candidate.reviewEvidence',
        message: 'No specialist review requires explicit null evidence.',
      });
  } else if (
    typeof reviewEvidence !== 'string' ||
    reviewEvidence.trim().length < 8 ||
    reviewEvidence.length > 500
  ) {
    issues.push({
      code: 'INVALID_SCHEMA',
      path: 'candidate.reviewEvidence',
      message: 'Specialist review needs an 8–500 character supporting quote.',
    });
  } else if (!(source as string).includes(reviewEvidence)) {
    issues.push({
      code: 'UNGROUNDED_EVIDENCE',
      path: 'candidate.reviewEvidence',
      message: 'Review quote does not occur exactly in the source.',
    });
  }
  if (issues.length) return { decision: 'rejected', issues };
  const reason = reviewReason as ReviewReason;
  const reasons = [
    'A person must verify the summary, category, priority and review reason before any action.',
  ];
  if (reason !== 'none')
    reasons.push(`Candidate requests specialist review: ${reason.replaceAll('_', ' ')}.`);
  if (base.candidate.priority === 'urgent') reasons.push('Candidate requests urgent review.');
  return {
    decision: 'review_required',
    candidate: {
      ...base.candidate,
      reviewReason: reason,
      reviewEvidence: reviewEvidence as string | null,
    },
    queue: reason !== 'none' || base.candidate.priority === 'urgent' ? 'escalation' : 'standard',
    reasons,
    issues: [],
  };
}
