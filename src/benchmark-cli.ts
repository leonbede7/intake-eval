import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { benchmark, parseDataset } from './benchmark.ts';
import { createProvider } from './provider.ts';
import type { Provider, Generation } from './provider.ts';
import { messagesFor } from './prompt.ts';
import { renderReport } from './report.ts';

async function readJson(file: string | URL): Promise<unknown> {
  if ((await stat(file)).size > 1_000_000) throw new Error('Input file exceeds 1 MB.');
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new Error('Cannot read JSON input.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(`Usage: npm run benchmark -- [--provider replay|deepseek|ollama] [--model name]
  [--input dataset.json] [--limit 1..50] [--out new-directory] [--capture] [--allow-paid]
Default: offline synthetic replay. DeepSeek requires --allow-paid and DEEPSEEK_API_KEY.
Ollama uses only localhost:11434 and an explicitly named, already-installed model.
--capture saves generated outputs locally for human review; reports omit them.
Limits: 512 output tokens per call, no retries, stop on first provider error.
Exit 0: run saved (label mismatches are measurements); 1: provider error; 2: setup error.`);
    return;
  }
  const flags = new Map<string, string | true>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index]!;
    if (flags.has(key)) throw new Error('Duplicate argument.');
    if (['--capture', '--allow-paid'].includes(key)) flags.set(key, true);
    else if (
      ['--provider', '--model', '--input', '--limit', '--out'].includes(key) &&
      args[index + 1] &&
      !args[index + 1]!.startsWith('--')
    )
      flags.set(key, args[++index]!);
    else throw new Error('Invalid arguments. Run with --help.');
  }
  const name = flags.get('--provider') ?? 'replay';
  if (!['replay', 'deepseek', 'ollama'].includes(name as string))
    throw new Error('Unknown provider.');
  if (name !== 'deepseek' && flags.has('--allow-paid'))
    throw new Error('--allow-paid is only for DeepSeek.');
  if (name === 'replay' && flags.has('--model')) throw new Error('Replay does not accept a model.');
  const model = flags.get('--model') as string | undefined;
  if (name === 'deepseek' && !flags.has('--allow-paid'))
    throw new Error('DeepSeek calls incur cost. Pass --allow-paid to opt in.');
  if (name === 'deepseek' && model && model !== 'deepseek-v4-flash')
    throw new Error('This bounded CLI supports only deepseek-v4-flash.');
  if (name === 'ollama' && !model)
    throw new Error('Name an already-installed local model with --model.');
  const limitText = flags.get('--limit') ?? (name === 'replay' ? '50' : '4');
  if (
    typeof limitText !== 'string' ||
    !/^\d+$/.test(limitText) ||
    Number(limitText) < 1 ||
    Number(limitText) > 50
  )
    throw new Error('Limit must be an integer from 1 to 50.');
  const cases = parseDataset(
    await readJson(
      (flags.get('--input') as string | undefined) ??
        new URL('../fixtures/labeled-triage.json', import.meta.url),
    ),
  ).slice(0, Number(limitText));
  let provider: Provider;
  if (name === 'replay') {
    if (flags.has('--input'))
      throw new Error(
        'Bundled replay only supports the bundled dataset. Use a live provider for other inputs.',
      );
    const outputs = await readJson(new URL('../fixtures/replay-outputs.json', import.meta.url));
    if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs))
      throw new Error('Invalid replay outputs.');
    provider = {
      name: 'replay',
      model: 'authored-examples-v1',
      async generate(_source, id) {
        if (!Object.hasOwn(outputs, id)) throw new Error('Missing replay output.');
        const value = (outputs as Record<string, unknown>)[id];
        return {
          output: typeof value === 'string' ? value : JSON.stringify(value),
          model: 'authored-examples-v1',
          latencyMs: null,
          usage: null,
        };
      },
    };
  } else {
    provider = createProvider({
      name: name as 'deepseek' | 'ollama',
      model: model ?? 'deepseek-v4-flash',
      ...(process.env.DEEPSEEK_API_KEY && name === 'deepseek'
        ? { apiKey: process.env.DEEPSEEK_API_KEY }
        : {}),
    });
  }
  // Conservative planning reserve, not an exact tokenizer or guaranteed billing cap.
  // Peak/cache-miss rates checked 2026-09-07; byte count + overhead overestimates these short text prompts.
  const reservationUsd = cases.reduce(
    (sum, entry) =>
      sum +
      ((Buffer.byteLength(JSON.stringify(messagesFor(entry.source)), 'utf8') + 1024) * 0.44 +
        512 * 1.32) /
        1_000_000,
    0,
  );
  if (name === 'deepseek' && reservationUsd > 0.1)
    throw new Error('Planning reserve exceeds $0.10; reduce --limit or input length.');
  const out = resolve(
    (flags.get('--out') as string | undefined) ??
      join('local-data', `run-${new Date().toISOString().replace(/[:.]/g, '-')}`),
  );
  // Fail before network calls if the target exists or cannot be created.
  await mkdir(resolve(out, '..'), { recursive: true });
  await mkdir(out);
  const captured: Array<{ id: string } & Generation> = [];
  const base = provider;
  if (flags.has('--capture'))
    provider = {
      ...base,
      async generate(source, id) {
        const generation = await base.generate(source, id);
        captured.push({ id, ...generation });
        return generation;
      },
    };
  console.log(
    `${name === 'replay' ? 'Synthetic replay' : 'Live model run'}: ${cases.length} case(s).`,
  );
  if (name === 'deepseek')
    console.log(
      `Conservative planning reserve: $${reservationUsd.toFixed(4)} at documented 2026-09-07 peak rates. No retries.`,
    );
  const report = await benchmark(cases, provider);
  await writeFile(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await writeFile(join(out, 'report.html'), renderReport(report), { flag: 'wx' });
  if (flags.has('--capture'))
    await writeFile(join(out, 'candidates.json'), `${JSON.stringify(captured, null, 2)}\n`, {
      flag: 'wx',
    });
  console.log(
    `${report.metrics.scorable}/${report.metrics.total} scorable; ${report.metrics.rejected} rejected; ${report.metrics.providerErrors} provider errors; ${report.dataset.skipped} skipped.`,
  );
  console.log(`Report saved: ${join(out, 'report.html')}`);
  process.exitCode = report.metrics.providerErrors ? 1 : 0;
}

main().catch((error: unknown) => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  console.error(
    code
      ? `Setup failed (${String(code)}). Use a new output directory and readable dataset.`
      : error instanceof Error
        ? error.message
        : 'Benchmark failed.',
  );
  process.exitCode = 2;
});
