import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { collectEvidence, writeEvidence } from './evidence.ts';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Usage: npm run evidence -- [--out NEW_DIRECTORY]\nReproduce bundled evidence without model calls or installation. Node.js 24+.\nExit codes: 0 reproduced; 1 drift; 2 setup or usage failure. No human review is performed.',
    );
    return;
  }
  if (
    args.length !== 0 &&
    !(args.length === 2 && args[0] === '--out' && args[1] && !args[1].startsWith('--'))
  )
    throw new Error('Invalid arguments. Use --help.');
  let folder: string;
  if (args.length) {
    folder = resolve(args[1]!);
    await mkdir(dirname(folder), { recursive: true });
    await mkdir(folder);
  } else {
    const parent = resolve('local-data');
    await mkdir(parent, { recursive: true });
    folder = await mkdtemp(join(parent, 'evidence-'));
  }
  console.log(
    'Revalidating saved model outputs and running synthetic loopback faults. No model calls.',
  );
  const evidence = await collectEvidence();
  await writeEvidence(evidence, folder);
  for (const check of evidence.checks)
    console.log(`${check.matched ? 'MATCH' : 'CHANGED'} ${check.name}: ${check.detail}`);
  console.log(
    `Report: ${join(folder, 'report.md')}\n${evidence.status === 'matched' ? 'Evidence reproduced.' : 'Evidence changed; inspect the report.'} This is not a new model run or human evaluation.`,
  );
  process.exitCode = evidence.status === 'matched' ? 0 : 1;
}
main().catch((error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
  console.error(
    code === 'EEXIST'
      ? 'Output directory already exists. Choose a new directory; existing work was not replaced.'
      : code
        ? `Evidence setup failed (${code}).`
        : error instanceof Error
          ? error.message
          : 'Evidence reproduction failed.',
  );
  process.exitCode = 2;
});
