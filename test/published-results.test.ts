import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { benchmark, parseDataset } from '../src/benchmark.ts';
import type { Generation } from '../src/provider.ts';

test('published baseline metrics can be reproduced from the captured synthetic outputs', async () => {
  const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const dataset = parseDataset(read('../fixtures/labeled-triage.json'));
  const published = read('../docs/results/deepseek-2026-09-07/report.json');
  const captures = read('../docs/results/deepseek-2026-09-07/candidates.json') as Array<
    Generation & { id: string }
  >;
  const replayed = await benchmark(dataset, {
    name: 'replay',
    model: published.requestedModel,
    async generate(_source, id) {
      const capture = captures.find((row) => row.id === id);
      assert.ok(capture, `Missing capture: ${id}`);
      return capture;
    },
  });
  assert.deepEqual(replayed.metrics, published.metrics);
  assert.deepEqual(replayed.rows, published.rows);
  assert.deepEqual(replayed.prompt, published.prompt);
  assert.equal(replayed.dataset.sha256, published.dataset.sha256);
});
