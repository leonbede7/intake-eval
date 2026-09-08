import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { benchmark, parseDataset, summarize } from '../src/benchmark.ts';
import { renderReport } from '../src/report.ts';
import { ProviderError } from '../src/provider.ts';
import type { Provider } from '../src/provider.ts';

const dataset = parseDataset(
  JSON.parse(readFileSync(new URL('../fixtures/labeled-triage.json', import.meta.url), 'utf8')),
);
const outputs = JSON.parse(
  readFileSync(new URL('../fixtures/replay-outputs.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const replay: Provider = {
  name: 'replay',
  model: 'authored-examples-v1',
  async generate(_source, id) {
    const output = outputs[id];
    return {
      output: typeof output === 'string' ? output : JSON.stringify(output),
      model: 'authored-examples-v1',
      usage: null,
      latencyMs: null,
    };
  },
};
const cli = fileURLToPath(new URL('../src/benchmark-cli.ts', import.meta.url));

test('replay exposes known failures without claiming a model run or measured latency', async () => {
  const report = await benchmark(dataset, replay);
  assert.equal(report.mode, 'synthetic-replay');
  assert.equal(report.metrics.total, 16);
  assert.equal(report.metrics.rejected, 2);
  assert.equal(report.metrics.scorable, 14);
  assert.equal(report.metrics.category.correct, 13);
  assert.equal(report.metrics.priority.correct, 12);
  assert.equal(report.metrics.escalation.missed, 2);
  assert.equal(report.metrics.escalation.falsePositives, 2);
  assert.equal(report.metrics.escalation.unscorable, 1);
  assert.equal(report.metrics.latencyMs.p50, null);
  assert.equal(report.metrics.tokens.measured, 0);
  assert.equal(report.metrics.summaryCorrectness, 'not_scored_requires_human_review');
});
test('live provider failure stops further calls and records skipped cases', async () => {
  let calls = 0;
  const provider: Provider = {
    name: 'deepseek',
    model: 'test',
    async generate() {
      calls++;
      throw new ProviderError('HTTP_ERROR');
    },
  };
  const report = await benchmark(dataset, provider);
  assert.equal(calls, 1);
  assert.equal(report.dataset.skipped, 15);
  assert.equal(report.metrics.providerErrors, 1);
  assert.equal(report.metrics.category.denominator, 0);
  assert.equal(report.rows[0]?.issues[0], 'HTTP_ERROR');
});
test('labels are not passed to the generation boundary', async () => {
  const provider: Provider = {
    name: 'replay',
    model: 'test',
    async generate(...args) {
      assert.equal(args.length, 2);
      assert.equal(args[0], dataset[0]!.source);
      assert.equal(args[1], dataset[0]!.id);
      return replay.generate(...args);
    },
  };
  await benchmark(dataset.slice(0, 1), provider);
});
test('report omits raw source and model summaries; model metadata is HTML-escaped', async () => {
  const report = await benchmark(dataset, replay);
  report.requestedModel = '<script>alert("x")</script>';
  const html = renderReport(report);
  assert.equal(html.includes('<script>'), false);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(html.includes(dataset[0]!.source), false);
  assert.equal(html.includes('The dashboard is broken.'), false);
  assert.match(html, /SYNTHETIC REPLAY : not model results/);
  assert.match(html, /Content-Security-Policy/);
});
test('empty measurement denominators and percentiles are not misleading zeros', () => {
  const metrics = summarize([]);
  assert.equal(metrics.category.denominator, 0);
  assert.equal(metrics.latencyMs.p95, null);
});
test('dataset rejects unknown labels, duplicates, misspelled fields and excessive inputs', () => {
  assert.throws(() => parseDataset([dataset[0], dataset[0]]));
  assert.throws(() =>
    parseDataset([
      { ...dataset[0], expected: { category: 'sales', priority: 'normal', escalation: false } },
    ]),
  );
  assert.throws(() => parseDataset([{ ...dataset[0], typo: true }]));
  assert.throws(() => parseDataset([{ ...dataset[0], source: 'x'.repeat(2001) }]));
});
test('CLI replay writes usable reports and refuses to overwrite', () => {
  const parent = mkdtempSync(join(tmpdir(), 'intake-benchmark-'));
  try {
    const out = join(parent, 'report');
    const run = spawnSync(process.execPath, [cli, '--out', out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).mode,
      'synthetic-replay',
    );
    assert.equal(existsSync(join(out, 'report.html')), true);
    assert.equal(existsSync(join(out, 'candidates.json')), false);
    assert.equal(spawnSync(process.execPath, [cli, '--out', out], { encoding: 'utf8' }).status, 2);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
test('CLI blocks paid calls without opt-in and rejects invalid run limits', () => {
  for (const args of [
    ['--provider', 'deepseek'],
    ['--limit', '0'],
    ['--limit', '1.5'],
    ['--limit', '51'],
    ['--provider', 'ollama'],
    ['--model', 'some-model'],
  ]) {
    assert.equal(spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' }).status, 2);
  }
});
