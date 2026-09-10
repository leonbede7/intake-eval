import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { evaluate, parseCases } from './evaluate.ts';
import { benchmark, parseDataset } from './benchmark.ts';
import type { BenchmarkReport } from './benchmark.ts';
import type { Generation } from './provider.ts';
import { runReliability } from './reliability.ts';

const defaultRoot = new URL('../', import.meta.url);
const compareFields = ['metrics', 'rows', 'prompt', 'dataset'] as const;
export function compareRecordedReport(actual: BenchmarkReport, published: BenchmarkReport) {
  return compareFields.filter((field) => !isDeepStrictEqual(actual[field], published[field]));
}
const inputs = [
  'fixtures/triage-cases.json',
  'fixtures/routing-comparison.json',
  'docs/results/routing-comparison/v1/candidates.json',
  'docs/results/routing-comparison/v1/report.json',
  'docs/results/routing-comparison/v2/candidates.json',
  'docs/results/routing-comparison/v2/report.json',
  'docs/results/reliability/report.json',
] as const;
const sources = [
  'src/triage.ts',
  'src/triage-v2.ts',
  'src/evaluate.ts',
  'src/benchmark.ts',
  'src/provider.ts',
  'src/prompt.ts',
  'src/reliability.ts',
  'src/evidence.ts',
  'src/evidence-cli.ts',
] as const;
const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

export async function collectEvidence(root = defaultRoot) {
  const text = async (path: string) =>
    new TextDecoder('utf-8', { fatal: true }).decode(await readFile(new URL(path, root)));
  const json = async (path: string) => JSON.parse(await text(path));
  const fixtures = evaluate(parseCases(await json(inputs[0])));
  const cases = parseDataset(await json(inputs[1]));
  const routing = [];
  for (const policy of ['v1', 'v2'] as const) {
    const base = `docs/results/routing-comparison/${policy}`;
    const captures: unknown = await json(`${base}/candidates.json`);
    if (!Array.isArray(captures) || captures.length !== cases.length)
      throw new Error(`Invalid ${policy} capture count.`);
    const recorded = new Map<string, Generation>();
    for (const c of captures) {
      if (
        !c ||
        typeof c.id !== 'string' ||
        recorded.has(c.id) ||
        !cases.some((row) => row.id === c.id) ||
        typeof c.output !== 'string' ||
        c.output.length > 20000 ||
        typeof c.model !== 'string' ||
        !(c.latencyMs === null || (Number.isFinite(c.latencyMs) && c.latencyMs >= 0)) ||
        !(
          c.usage === null ||
          (c.usage &&
            Number.isSafeInteger(c.usage.inputTokens) &&
            c.usage.inputTokens >= 0 &&
            Number.isSafeInteger(c.usage.outputTokens) &&
            c.usage.outputTokens >= 0)
        )
      )
        throw new Error(`Invalid or duplicate ${policy} capture.`);
      recorded.set(c.id, c);
    }
    const published = (await json(`${base}/report.json`)) as BenchmarkReport;
    const report = await benchmark(
      cases,
      {
        name: 'replay',
        model: published.requestedModel,
        async generate(_source, id) {
          const capture = recorded.get(id);
          if (!capture) throw new Error('Missing recorded output.');
          return capture;
        },
      },
      policy,
    );
    routing.push({
      policy,
      capturedAt: published.createdAt,
      generation: 'recorded_model_responses' as const,
      timing:
        'Latency and token usage are historical metadata from captures, not measurements made by this replay.',
      changedFields: compareRecordedReport(report, published),
      report,
    });
  }
  const reliability = await runReliability();
  const publishedFaults = await json('docs/results/reliability/report.json');
  const checks = [
    {
      name: 'Synthetic fixture expectations',
      matched: fixtures.failed === 0,
      detail: `${fixtures.passed}/${fixtures.total} expectations matched.`,
    },
    ...routing.map((r) => ({
      name: `${r.policy.toUpperCase()} recorded report reproduction`,
      matched: r.changedFields.length === 0,
      detail: r.changedFields.length
        ? `Changed fields: ${r.changedFields.join(', ')}.`
        : 'Rows, metrics, prompt and dataset match the published report.',
    })),
    {
      name: 'Offline fault contracts and known limitation',
      matched: reliability.regressions === 0,
      detail: `${reliability.matched}/${reliability.checks} contracts; ${reliability.knownLimitsMatched}/${reliability.knownLimits} known-limit expectations matched.`,
    },
    {
      name: 'Published fault snapshot',
      matched: isDeepStrictEqual(reliability, publishedFaults),
      detail: 'Compare current fault results and source fingerprint with the published snapshot.',
    },
  ];
  const fingerprints = [];
  for (const path of inputs)
    fingerprints.push({ path, sha256: digest((await text(path)).replaceAll('\r\n', '\n')) });
  // Hash the executed implementation, even when a test supplies a different fixture root.
  for (const path of sources)
    fingerprints.push({
      path,
      sha256: digest((await readFile(new URL(path, defaultRoot), 'utf8')).replaceAll('\r\n', '\n')),
    });
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    kind: 'offline_evidence_reproduction' as const,
    status: checks.every((c) => c.matched) ? ('matched' as const) : ('drift' as const),
    methodology:
      'Recorded model outputs are revalidated. Synthetic HTTP faults run on loopback. No model is called, no API key is read and no human judgments are created. This command does not run the full unit or browser test suites.',
    fingerprintFormat: 'SHA-256 of UTF-8 files with CRLF normalized to LF.',
    checks,
    fingerprints,
    fixtures,
    routing,
    reliability,
  };
}
export type Evidence = Awaited<ReturnType<typeof collectEvidence>>;
export function evidenceMarkdown(e: Evidence) {
  const count = e.checks.filter((c) => c.matched).length;
  return `# Intake Eval: reproduced evidence

Status: **${e.status.toUpperCase()}**. ${count}/${e.checks.length} evidence checks matched.

Generated ${e.createdAt}.

${e.methodology}

## Reproduction checks

| Check | Result | Detail |
| --- | --- | --- |
${e.checks.map((c) => `| ${c.name} | ${c.matched ? 'Matched' : 'Changed'} | ${c.detail} |`).join('\n')}

## Recorded routing comparison

| Policy | Cases | Missed escalations | Unnecessary escalations | Rejected | Provider errors |
| --- | --- | --- | --- | --- | --- |
${e.routing
  .map((r) => {
    const m = r.report.metrics;
    return `| ${r.policy.toUpperCase()} | ${m.total} | ${m.escalation.missed}/${m.escalation.expected} | ${m.escalation.falsePositives}/${m.escalation.standardScorable} | ${m.rejected} | ${m.providerErrors} |`;
  })
  .join('\n')}

Known V1 routing mismatches are expected development findings. Reproducing them is a match, not a new regression. A changed report is flagged even if the new result looks better.

The labels are AI-authored and provisional. This is a targeted development set, not independent accuracy or a held-out benchmark. No summary-correctness score or author review is implied.

Latency and token values in the routing JSON are historical capture metadata, not timings measured by this command. Recorded runs: ${e.routing.map((r) => `${r.policy.toUpperCase()} ${r.capturedAt}`).join('; ')}.

## Inspect the files

- [Fixture results](fixtures.json)
- [V1 reproduction](routing-v1.json)
- [V2 reproduction](routing-v2.json)
- [Offline fault results](reliability.json)
- [Checks and input/source fingerprints](evidence.json)
- [Output file hashes](manifest.json)

The fault report deliberately includes a false summary with a real quote. Its passage to human review is a reproduced limitation, not proof that the summary is correct.

The manifest hashes each output file's exact bytes, excluding the manifest itself. It detects accidental changes; it is not a signature or an independent attestation.

To check application behavior beyond this packet, run \`npm ci\`, \`npm run check\`, install Playwright Chromium and run \`npm run test:e2e\`. See the repository's [reviewer guide](https://github.com/leonbede7/intake-eval/blob/main/docs/reviewer-guide.md).
`;
}
export async function writeEvidence(e: Evidence, folder: string) {
  const { fixtures, routing, reliability, ...summary } = e;
  const files: Record<string, string> = {
    'report.md': evidenceMarkdown(e),
    'evidence.json': JSON.stringify(summary, null, 2) + '\n',
    'fixtures.json': JSON.stringify(fixtures, null, 2) + '\n',
    'reliability.json': JSON.stringify(reliability, null, 2) + '\n',
  };
  for (const r of routing) files[`routing-${r.policy}.json`] = JSON.stringify(r, null, 2) + '\n';
  const outputs = [];
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(folder, name), content, { flag: 'wx' });
    outputs.push({
      path: name,
      bytes: Buffer.byteLength(content, 'utf8'),
      sha256: digest(content),
    });
  }
  await writeFile(
    join(folder, 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, algorithm: 'sha256', outputs }, null, 2) + '\n',
    { flag: 'wx' },
  );
}
