import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseDataset } from './benchmark.ts';
import type { Generation } from './provider.ts';
import { createHash } from 'node:crypto';
import { reviewDatasetId } from './human-review.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = async (relative: string) => JSON.parse(await readFile(join(root, relative), 'utf8'));
const cases = parseDataset(await read('fixtures/routing-comparison.json'));
const samples = cases.map(({ id, source, language, expected }) => ({
  id,
  source,
  language,
  expected,
  candidates: { v1: '', v2: '' },
}));
const comparison: Record<string, unknown> = {};
for (const policy of ['v1', 'v2'] as const) {
  const base = `docs/results/routing-comparison/${policy}`;
  comparison[policy] = await read(`${base}/report.json`);
  const captures = (await read(`${base}/candidates.json`)) as Array<Generation & { id: string }>;
  for (const sample of samples) {
    const found = captures.find((capture) => capture.id === sample.id);
    if (!found) throw new Error(`Missing public capture for ${policy}/${sample.id}.`);
    sample.candidates[policy] = found.output;
  }
}
await mkdir(join(root, 'site/data'), { recursive: true });
for (const name of ['index.html', 'styles.css', 'app.js', 'review.html', 'review.css', 'review.js'])
  await copyFile(join(root, 'web', name), join(root, 'site', name));
await writeFile(
  join(root, 'site/data/demo.json'),
  `${JSON.stringify({ samples, comparison }, null, 2)}\n`,
);
await writeFile(join(root, 'site/.nojekyll'), '');
const reviewSamples = samples.map(({ id, source, language, expected, candidates }) => ({
  id,
  source,
  language,
  expected,
  candidate: candidates.v2,
}));
const reviewHash = createHash('sha256')
  .update(JSON.stringify({ id: reviewDatasetId, samples: reviewSamples }))
  .digest('hex');
await writeFile(
  join(root, 'site/data/review.json'),
  JSON.stringify({ id: reviewDatasetId, hash: reviewHash, samples: reviewSamples }, null, 2) + '\n',
);
await copyFile(
  join(root, 'docs/results/reliability/report.html'),
  join(root, 'site/reliability.html'),
);
console.log(
  'Static playground built in site/ from public synthetic captures. No credentials or provider code included.',
);
