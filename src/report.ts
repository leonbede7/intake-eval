import type { BenchmarkReport } from './benchmark.ts';

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
const ratio = (correct: number, denominator: number) =>
  denominator ? `${correct} / ${denominator}` : 'Not scorable';

export function renderReport(report: BenchmarkReport): string {
  const m = report.metrics;
  const rows = report.rows
    .map((row) => {
      const mismatch =
        row.predicted &&
        (row.predicted.category !== row.expected.category ||
          row.predicted.priority !== row.expected.priority ||
          row.predicted.escalation !== row.expected.escalation);
      const status =
        row.outcome === 'provider_error'
          ? 'Provider error'
          : row.outcome === 'rejected'
            ? 'Rejected'
            : mismatch
              ? 'Label mismatch'
              : 'Labels match';
      return `<tr><th scope="row">${escape(row.id)}<small>${escape(row.language.toUpperCase())}</small></th><td>${escape(row.expected.category)} / ${escape(row.expected.priority)}<small>${row.expected.escalation ? 'Escalation' : 'Standard review'}</small></td><td>${row.predicted ? `${escape(row.predicted.category)} / ${escape(row.predicted.priority)}<small>${row.predicted.escalation ? 'Escalation' : 'Standard review'}</small>` : 'Not scorable'}</td><td><span class="${status === 'Labels match' ? 'match' : 'attention'}">${status}</span><small>${row.issues.map(escape).join(', ')}</small></td></tr>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Intake Eval : Evaluation report</title>
<style>
:root{font-family:Arial,Helvetica,sans-serif;color:#122339;background:#f5f7fa;font-synthesis:none}*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:56px 28px}a{color:#174ca6}header{border-top:5px solid #174ca6;padding-top:20px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#174ca6}h1{font-size:clamp(36px,6vw,68px);line-height:1.02;letter-spacing:-.05em;margin:24px 0 20px}p{line-height:1.65;max-width:78ch}.notice{border-left:4px solid #af5700;background:#fff0dc;padding:16px 20px;margin:26px 0;color:#673300}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#c7d0dc;border:1px solid #c7d0dc;margin:32px 0}.metric{background:white;padding:24px 20px}.metric strong{display:block;font-size:32px;letter-spacing:-.04em;margin:12px 0}.metric small,small{display:block;font-size:12px;line-height:1.5;color:#485a70;margin-top:6px}h2{font-size:24px;margin-top:40px;letter-spacing:-.025em}.table-wrap{overflow-x:auto;background:white;border:1px solid #c7d0dc}table{border-collapse:collapse;width:100%;min-width:720px;text-align:left;font-size:14px}caption{text-align:left;padding:18px;font-weight:700}th,td{padding:16px 18px;border-top:1px solid #dce2e9;vertical-align:top}thead th{font-size:12px;background:#eaf0f7}tbody th{font-weight:600}.match{color:#0a6240;font-weight:700}.attention{color:#954900;font-weight:700}.details{display:grid;grid-template-columns:1fr 1fr;gap:32px}code{overflow-wrap:anywhere;font-size:12px}footer{margin-top:40px;border-top:1px solid #c7d0dc;padding-top:20px;font-size:13px;color:#485a70}dt{font-weight:700;font-size:13px;margin-top:16px}dd{margin:5px 0 0;overflow-wrap:anywhere;line-height:1.5}@media(max-width:700px){main{padding:28px 18px}.metrics{grid-template-columns:1fr 1fr}.details{grid-template-columns:1fr}h1{margin-top:20px}.metric{padding:18px 14px}}@media print{main{padding:0}.table-wrap{overflow:visible}table{min-width:0}tr{break-inside:avoid}.metric{padding:12px}h1{font-size:36px}}
</style></head><body><main><header><div class="eyebrow">Intake Eval / Evaluation report</div><h1>Evaluation results</h1><p>A case-by-case view of classification, output validation and escalation. Summary truthfulness still requires human review.</p></header>
<div class="notice"><strong>${report.mode === 'synthetic-replay' ? 'SYNTHETIC REPLAY : not model results.' : 'LIVE MODEL RUN : provisional synthetic benchmark.'}</strong><br>${report.mode === 'synthetic-replay' ? 'Outputs were authored to demonstrate successes and failures. No model was called; latency and token usage are not measured.' : 'Outputs came from API calls. This small AI-authored dataset has not been independently human-validated and does not establish real-world accuracy.'}</div>
<section class="metrics" aria-label="Evaluation metrics"><div class="metric">Cases attempted<strong>${m.total}</strong><small>${report.dataset.skipped} skipped · ${m.providerErrors} provider errors</small></div><div class="metric">Category matches<strong>${ratio(m.category.correct, m.category.denominator)}</strong><small>Among ${m.scorable} valid outputs; ${m.rejected} rejected</small></div><div class="metric">Priority matches<strong>${ratio(m.priority.correct, m.priority.denominator)}</strong><small>Same valid-output denominator</small></div><div class="metric">Missed escalations<strong>${m.escalation.missed}</strong><small>${m.escalation.expected} expected · ${m.escalation.unscorable} not scorable</small></div></section>
<p><strong>${m.escalation.falsePositives} unnecessary escalation(s)</strong> among ${m.escalation.standardScorable} scorable standard-review cases. Rejections and provider errors are excluded from classification denominators, shown separately, and never counted as correct.</p>
<h2>Inspect each case</h2><div class="table-wrap" role="region" aria-label="Scrollable case results" tabindex="0"><table><caption>Provisional labels compared with the full model-and-validator workflow</caption><thead><tr><th scope="col">Case</th><th scope="col">Expected</th><th scope="col">Observed</th><th scope="col">Result</th></tr></thead><tbody>${rows}</tbody></table></div>
<section class="details"><div><h2>Reproduce this run</h2><dl><dt>Provider / requested model</dt><dd>${escape(report.provider)} / ${escape(report.requestedModel)}</dd><dt>Prompt</dt><dd>${escape(report.prompt.version)}<br><code>${escape(report.prompt.sha256)}</code></dd><dt>Dataset SHA-256</dt><dd><code>${escape(report.dataset.sha256)}</code></dd><dt>Settings</dt><dd>Temperature 0 · up to 512 output tokens · no retries</dd><dt>Created</dt><dd>${escape(report.createdAt)}</dd></dl></div><div><h2>Read the limits</h2><p>${escape(report.dataset.labels)}. Label matches measure the stated category and priority policy; they do not prove that a summary is true or that a reply is safe to send.</p><p>Escalation results combine candidate priority with ${report.policy === 'v2' ? 'an explicit specialist-review reason and quote' : 'the deterministic source-keyword rule'}. A mismatch can be a routing-rule problem even when the model classified correctly.</p><p>Latency p50 / p95: <strong>${m.latencyMs.p50 === null ? 'Not measured' : `${m.latencyMs.p50} / ${m.latencyMs.p95} ms`}</strong> (${m.latencyMs.measured} completed responses). Token counts: ${m.tokens.measured ? `${m.tokens.input} input / ${m.tokens.output} output, supplied for ${m.tokens.measured} responses` : 'Not measured'}. These are not a billing statement.</p></div></section>
<footer>Built with AI assistance by Leon Bede · <a href="https://github.com/leonbede7/intake-eval">Source, tests and methodology</a><p>Reports omit source messages, summaries, quotes and credentials. Review the local dataset and captured outputs separately before drawing conclusions about semantics.</p></footer></main></body></html>`;
}
