import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluate, parseCases } from '../src/evaluate.ts';

const fixtures: unknown = JSON.parse(readFileSync(new URL('../fixtures/triage-cases.json', import.meta.url), 'utf8'));
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('all synthetic fixture expectations match', () => {
  const report = evaluate(parseCases(fixtures));
  assert.equal(report.total, 12);
  assert.equal(report.failed, 0);
});
test('fixture validation rejects empty suites and duplicate ids', () => {
  const first = parseCases(fixtures)[0]!;
  assert.throws(() => parseCases([]));
  assert.throws(() => parseCases([first, first]), /unique/);
});
test('fixture validation rejects missing candidate, queue and misspelled expectation keys', () => {
  const first = parseCases(fixtures)[0]!;
  assert.throws(() => parseCases([{ id: 'missing', source: 'hello', expected: first.expected }]));
  assert.throws(() => parseCases([{ ...first, expected: { decision: 'review_required' } }]));
  assert.throws(() => parseCases([{ ...first, expected: { decision: 'rejected', issueCode: 'INVALID_JSON' } }]));
});
test('wrong decision, queue or issue codes are regressions', () => {
  const cases = parseCases(fixtures);
  assert.equal(evaluate([{ ...cases[0]!, expected: { decision: 'rejected' } }]).failed, 1);
  assert.equal(evaluate([{ ...cases[0]!, expected: { decision: 'review_required', queue: 'escalation' } }]).failed, 1);
  assert.equal(evaluate([{ ...cases[6]!, expected: { decision: 'rejected', issueCodes: ['INVALID_SCHEMA'] } }]).failed, 1);
});
test('reports do not include source or candidate text', () => {
  const report = JSON.stringify(evaluate(parseCases(fixtures)));
  assert.equal(report.includes('The export button gives an error'), false);
  assert.equal(report.includes('Customer requests a duplicate'), false);
});
test('CLI emits valid JSON with exit 0 for matching expectations', () => {
  const result = run('--json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).passed, 12);
});
test('CLI returns exit 2 for bad arguments and missing files', () => {
  for (const args of [['--unknown'], ['--input'], ['--json', '--json'], ['--input', 'nonexistent-fixture-file.json']]) {
    const result = run(...args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
  }
});
test('CLI returns exit 1 for regression and exit 2 for malformed fixtures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'intake-eval-'));
  try {
    const file = join(dir, 'cases.json');
    writeFileSync(file, JSON.stringify([{ ...parseCases(fixtures)[0], expected: { decision: 'rejected' } }]));
    const regression = run('--input', file, '--json');
    assert.equal(regression.status, 1);
    assert.equal(JSON.parse(regression.stdout).failed, 1);
    writeFileSync(file, '{invalid private customer text');
    const malformed = run('--input', file);
    assert.equal(malformed.status, 2);
    assert.equal(malformed.stderr.includes('private customer text'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
