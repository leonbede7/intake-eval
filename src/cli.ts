import { readFile } from 'node:fs/promises';
import { evaluate, parseCases } from './evaluate.ts';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      'Usage: npm run demo -- [--input cases.json] [--json]\nExit codes: 0 expectations match; 1 regression; 2 invalid input or usage.\nDefault: bundled synthetic fixtures. No network calls or model credentials.',
    );
    return;
  }
  let input: string | URL = new URL('../fixtures/triage-cases.json', import.meta.url);
  let json = false;
  let inputSeen = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json' && !json) json = true;
    else if (
      arg === '--input' &&
      !inputSeen &&
      args[index + 1] &&
      !args[index + 1]!.startsWith('--')
    ) {
      input = args[++index]!;
      inputSeen = true;
    } else throw new Error('Invalid arguments. Run with --help for usage.');
  }
  const data = await readFile(input);
  if (data.byteLength > 5_000_000) throw new Error('Fixture file exceeds 5 MB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString('utf8'));
  } catch {
    throw new Error('Fixture file is not valid JSON.');
  }
  const report = evaluate(parseCases(parsed));
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('INTAKE EVAL — synthetic regression suite\n');
    for (const result of report.results)
      console.log(
        `${result.passed ? 'PASS' : 'FAIL'}  ${result.id} → ${result.decision}${result.queue ? ` / ${result.queue}` : ''}`,
      );
    console.log(
      `\n${report.passed}/${report.total} expectations matched. ${report.failed} regression(s).`,
    );
    console.log('This measures guardrail behavior on fixtures, not model accuracy.');
  }
  process.exitCode = report.failed > 0 ? 1 : 0;
}

main().catch((error: unknown) => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  console.error(
    code
      ? `Could not read fixture file (${String(code)}).`
      : error instanceof Error
        ? error.message
        : 'Evaluation failed.',
  );
  process.exitCode = 2;
});
