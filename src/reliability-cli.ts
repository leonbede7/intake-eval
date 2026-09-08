import { mkdir, writeFile } from 'node:fs/promises';
import { runReliability } from './reliability.ts';
import { reliabilityHtml } from './reliability-report.ts';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--publish')) {
  console.error('Usage: npm run reliability -- [--publish]');
  process.exitCode = 2;
} else {
  try {
    const report = await runReliability();
    const folder = args[0] === '--publish' ? 'docs/results/reliability' : 'local-data/reliability';
    await mkdir(folder, { recursive: true });
    await writeFile(folder + '/report.json', JSON.stringify(report, null, 2) + '\n');
    await writeFile(folder + '/report.html', reliabilityHtml(report));
    for (const row of report.rows)
      console.log(
        `${row.matched ? 'MATCH' : 'REGRESSION'} ${row.id}: ${row.observed} (${row.attempts} attempt)`,
      );
    console.log(
      `${report.matched}/${report.checks} contract checks matched. ${report.knownLimitsMatched}/${report.knownLimits} known-limit expectations matched. ${report.regressions} regression(s).\n${folder}/report.html\nOffline fault injection, not model performance.`,
    );
    if (report.regressions) process.exitCode = 1;
  } catch {
    console.error('Reliability run failed. No model calls were made.');
    process.exitCode = 2;
  }
}
