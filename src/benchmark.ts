import { createHash } from 'node:crypto';
import { categories, priorities, reviewCandidate } from './triage.ts';
import type { Category, Priority } from './triage.ts';
import { ProviderError } from './provider.ts';
import type { Provider } from './provider.ts';
import { PROMPT_HASH, PROMPT_VERSION } from './prompt.ts';

export interface LabeledCase {
  id: string;
  source: string;
  language: 'en' | 'hr';
  expected: { category: Category; priority: Priority; escalation: boolean };
  rationale: string;
}

export function parseDataset(value: unknown): LabeledCase[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50)
    throw new Error('Dataset needs 1–50 labeled cases.');
  const ids = new Set<string>();
  for (const row of value) {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      typeof row.id !== 'string' ||
      !/^[a-z0-9-]{1,64}$/.test(row.id) ||
      ids.has(row.id) ||
      typeof row.source !== 'string' ||
      row.source.trim().length < 8 ||
      row.source.length > 2000 ||
      !['en', 'hr'].includes(row.language) ||
      typeof row.rationale !== 'string' ||
      !row.rationale.trim() ||
      !row.expected ||
      typeof row.expected !== 'object' ||
      Array.isArray(row.expected) ||
      !categories.includes(row.expected.category) ||
      !priorities.includes(row.expected.priority) ||
      typeof row.expected.escalation !== 'boolean'
    )
      throw new Error('Invalid dataset case or duplicate ID.');
    if (
      Object.keys(row).some(
        (key) => !['id', 'source', 'language', 'expected', 'rationale'].includes(key),
      ) ||
      Object.keys(row.expected).some((key) => !['category', 'priority', 'escalation'].includes(key))
    )
      throw new Error('Unknown dataset field.');
    ids.add(row.id);
  }
  return value as LabeledCase[];
}

export interface BenchmarkRow {
  id: string;
  language: 'en' | 'hr';
  expected: LabeledCase['expected'];
  predicted: { category: Category; priority: Priority; escalation: boolean } | null;
  outcome: 'review_required' | 'rejected' | 'provider_error';
  issues: string[];
  latencyMs: number | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  model: string | null;
}

export function summarize(rows: BenchmarkRow[]) {
  const valid = rows.filter((row) => row.predicted !== null);
  const expectedEscalation = rows.filter((row) => row.expected.escalation);
  const standard = valid.filter((row) => !row.expected.escalation);
  const latency = rows
    .map((row) => row.latencyMs)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  return {
    total: rows.length,
    providerErrors: rows.filter((row) => row.outcome === 'provider_error').length,
    rejected: rows.filter((row) => row.outcome === 'rejected').length,
    scorable: valid.length,
    category: {
      correct: valid.filter((row) => row.predicted!.category === row.expected.category).length,
      denominator: valid.length,
    },
    priority: {
      correct: valid.filter((row) => row.predicted!.priority === row.expected.priority).length,
      denominator: valid.length,
    },
    escalation: {
      expected: expectedEscalation.length,
      missed: expectedEscalation.filter((row) => row.predicted?.escalation === false).length,
      unscorable: expectedEscalation.filter((row) => row.predicted === null).length,
      falsePositives: standard.filter((row) => row.predicted!.escalation).length,
      standardScorable: standard.length,
    },
    latencyMs: {
      measured: latency.length,
      p50: latency.length ? latency[Math.ceil(latency.length * 0.5) - 1]! : null,
      p95: latency.length ? latency[Math.ceil(latency.length * 0.95) - 1]! : null,
    },
    tokens: {
      measured: rows.filter((row) => row.usage !== null).length,
      input: rows.reduce((sum, row) => sum + (row.usage?.inputTokens ?? 0), 0),
      output: rows.reduce((sum, row) => sum + (row.usage?.outputTokens ?? 0), 0),
    },
    summaryCorrectness: 'not_scored_requires_human_review' as const,
  };
}

export async function benchmark(cases: LabeledCase[], provider: Provider) {
  const rows: BenchmarkRow[] = [];
  for (const entry of cases) {
    let row: BenchmarkRow = {
      id: entry.id,
      language: entry.language,
      expected: entry.expected,
      predicted: null,
      outcome: 'provider_error',
      issues: [],
      latencyMs: null,
      usage: null,
      model: null,
    };
    try {
      // Ground-truth labels and rationales are deliberately excluded from generation.
      const generated = await provider.generate(entry.source, entry.id);
      const review = reviewCandidate(entry.source, generated.output);
      row = {
        ...row,
        outcome: review.decision,
        latencyMs: generated.latencyMs,
        usage: generated.usage,
        model: generated.model,
        issues: [...new Set(review.issues.map((issue) => issue.code))],
        predicted:
          review.decision === 'review_required'
            ? {
                category: review.candidate.category,
                priority: review.candidate.priority,
                escalation: review.queue === 'escalation',
              }
            : null,
      };
    } catch (error) {
      row.issues = [error instanceof ProviderError ? error.code : 'GENERATION_ERROR'];
    }
    rows.push(row);
    // Avoid multiplying billable failures after a network/auth/provider incident.
    if (row.outcome === 'provider_error' && provider.name !== 'replay') break;
  }
  return {
    schemaVersion: 1,
    mode: provider.name === 'replay' ? 'synthetic-replay' : 'live-model',
    createdAt: new Date().toISOString(),
    provider: provider.name,
    requestedModel: provider.model,
    prompt: { version: PROMPT_VERSION, sha256: PROMPT_HASH },
    dataset: {
      sha256: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
      selected: cases.length,
      attempted: rows.length,
      skipped: cases.length - rows.length,
      labels: 'AI-authored provisional labels; not independently human-validated',
    },
    settings: { temperature: 0, maxOutputTokens: 512, retries: 0 },
    metrics: summarize(rows),
    rows,
  };
}

export type BenchmarkReport = Awaited<ReturnType<typeof benchmark>>;
