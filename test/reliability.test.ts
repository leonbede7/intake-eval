import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runReliability } from '../src/reliability.ts';
import { reliabilityHtml } from '../src/reliability-report.ts';

test('real loopback faults reproduce the published contracts and known limitation', async () => {
  const report = await runReliability();
  const published = JSON.parse(
    await readFile(new URL('../docs/results/reliability/report.json', import.meta.url), 'utf8'),
  );
  assert.equal(report.regressions, 0);
  assert.equal(report.matched, 14);
  assert.equal(report.knownLimits, 1);
  assert.equal(report.knownLimitsMatched, 1);
  assert.deepEqual(
    report,
    published,
    'Published evidence is stale: rerun npm run reliability -- --publish and review changes.',
  );
  assert.equal(
    report.rows.find((x) => x.id === 'invalid-utf8')?.observed,
    'provider_error:INVALID_RESPONSE',
  );
  assert.equal(
    report.rows.find((x) => x.id === 'false-summary')?.observed,
    'review_required:standard',
  );
  const html = reliabilityHtml(report);
  assert.equal(
    html,
    (
      await readFile(new URL('../docs/results/reliability/report.html', import.meta.url), 'utf8')
    ).replaceAll('\r\n', '\n'),
    'Published HTML must match the verified JSON report.',
  );
  assert.ok(!html.includes('synthetic-private-marker-do-not-publish'));
  assert.ok(!html.includes('offline-test-credential'));
  const hostile = { ...report, source: '<script>alert("not executable")</script>' };
  assert.ok(!reliabilityHtml(hostile).includes('<script>'));
  assert.ok(reliabilityHtml(hostile).includes('&lt;script&gt;'));
});
