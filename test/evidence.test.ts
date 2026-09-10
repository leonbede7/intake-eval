import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  collectEvidence,
  compareRecordedReport,
  evidenceMarkdown,
  writeEvidence,
} from '../src/evidence.ts';
const cli = fileURLToPath(new URL('../src/evidence-cli.ts', import.meta.url));
async function tempDir(t: { after(fn: () => Promise<void>): void }) {
  const folder = await mkdtemp(join(tmpdir(), 'intake-evidence-'));
  t.after(async () => {
    assert.equal(dirname(folder), resolve(tmpdir()));
    assert.ok(folder.startsWith(join(tmpdir(), 'intake-evidence-')));
    await rm(folder, { recursive: true, force: true });
  });
  return folder;
}
test('evidence reproduces recorded failures without treating them as new regressions', async () => {
  const evidence = await collectEvidence();
  assert.equal(evidence.status, 'matched');
  assert.equal(evidence.checks.length, 5);
  assert.ok(evidence.checks.every((c) => c.matched));
  const v1 = evidence.routing[0]!,
    v2 = evidence.routing[1]!;
  assert.equal(
    v1.report.metrics.escalation.missed + v1.report.metrics.escalation.falsePositives,
    5,
  );
  assert.equal(
    v2.report.metrics.escalation.missed + v2.report.metrics.escalation.falsePositives,
    0,
  );
  assert.equal(v1.generation, 'recorded_model_responses');
  assert.equal(evidence.reliability.knownLimitsMatched, 1);
  assert.ok(evidence.fingerprints.every((f) => /^[a-f0-9]{64}$/.test(f.sha256)));
  assert.match(evidenceMarkdown(evidence), /historical capture metadata/);
});
test('report drift detects changed rows, metrics, prompt and dataset even when counts look better', async () => {
  const evidence = await collectEvidence();
  const original = evidence.routing[0]!.report;
  for (const field of ['rows', 'metrics', 'prompt', 'dataset'] as const) {
    const changed = structuredClone(original);
    if (field === 'rows') changed.rows[0]!.predicted = null;
    if (field === 'metrics') changed.metrics.escalation.falsePositives = 0;
    if (field === 'prompt') changed.prompt.sha256 = 'changed';
    if (field === 'dataset') changed.dataset.sha256 = 'changed';
    assert.deepEqual(compareRecordedReport(changed, original), [field]);
  }
  const newTimestamp = { ...original, createdAt: new Date().toISOString() };
  assert.deepEqual(compareRecordedReport(newTimestamp, original), []);
});
test('packet hashes describe exact output bytes and files cannot be silently overwritten', async (t) => {
  const folder = await tempDir(t);
  const evidence = await collectEvidence();
  await writeEvidence(evidence, folder);
  const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  assert.equal(manifest.outputs.length, 6);
  for (const file of manifest.outputs) {
    const bytes = await readFile(join(folder, file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  await assert.rejects(writeEvidence(evidence, folder), { code: 'EEXIST' });
  const summary = JSON.parse(await readFile(join(folder, 'evidence.json'), 'utf8'));
  assert.equal(summary.status, 'matched');
  assert.equal(Object.hasOwn(summary, 'routing'), false);
});
test('CLI rejects unsupported paid flags and existing output directories', async (t) => {
  const folder = await tempDir(t);
  for (const args of [
    ['--provider', 'deepseek'],
    ['--help', '--out', 'anything'],
    ['--out'],
    ['--out', folder],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: folder, encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout, /Revalidating/);
  }
  const help = spawnSync(process.execPath, [cli, '--help'], { cwd: folder, encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /No human review/);
});
test('clean checkout works without node_modules; changed fixtures make the CLI fail with an inspectable report', async (t) => {
  const folder = await tempDir(t);
  const root = fileURLToPath(new URL('../', import.meta.url));
  await cp(join(root, 'src'), join(folder, 'src'), { recursive: true });
  await mkdir(join(folder, 'fixtures'));
  for (const file of ['triage-cases.json', 'routing-comparison.json'])
    await cp(join(root, 'fixtures', file), join(folder, 'fixtures', file));
  for (const policy of ['v1', 'v2']) {
    const relative = `docs/results/routing-comparison/${policy}`;
    await mkdir(join(folder, relative), { recursive: true });
    for (const file of ['candidates.json', 'report.json'])
      await cp(join(root, relative, file), join(folder, relative, file));
  }
  await mkdir(join(folder, 'docs/results/reliability'), { recursive: true });
  await cp(
    join(root, 'docs/results/reliability/report.json'),
    join(folder, 'docs/results/reliability/report.json'),
  );
  await cp(join(root, 'package.json'), join(folder, 'package.json'));
  const cleanCli = join(folder, 'src/evidence-cli.ts');
  const run = (out: string) =>
    spawnSync(process.execPath, [cleanCli, '--out', out], {
      cwd: folder,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, DEEPSEEK_API_KEY: 'evidence-test-placeholder-never-read' },
    });
  const good = run('good');
  assert.equal(good.status, 0, good.stderr);
  assert.doesNotMatch(
    await readFile(join(folder, 'good/evidence.json'), 'utf8'),
    /evidence-test-placeholder/,
  );
  const path = join(folder, 'fixtures/triage-cases.json');
  const fixtures = JSON.parse(await readFile(path, 'utf8'));
  fixtures[0].expected.queue =
    fixtures[0].expected.queue === 'standard' ? 'escalation' : 'standard';
  await writeFile(path, JSON.stringify(fixtures));
  const changed = run('changed');
  assert.equal(changed.status, 1, changed.stderr);
  assert.equal(
    JSON.parse(await readFile(join(folder, 'changed/evidence.json'), 'utf8')).status,
    'drift',
  );
  // A corrupt capture is a setup error, not a successful reproduction of missing evidence.
  const capturePath = join(folder, 'docs/results/routing-comparison/v1/candidates.json');
  await writeFile(capturePath, '[]');
  const corrupt = run('corrupt');
  assert.equal(corrupt.status, 2);
  assert.match(corrupt.stderr, /capture count/);
});
