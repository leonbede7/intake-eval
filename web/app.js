import { reviewCandidate } from './lib/triage.js';
import { reviewCandidateV2 } from './lib/triage-v2.js';

const $ = (id) => document.getElementById(id);
let samples = [];
let live = null;
let busy = false;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function setBusy(value) {
  busy = value;
  for (const id of ['example', 'policy', 'request', 'candidate', 'validate', 'reset', 'generate'])
    $(id).disabled = value;
  document.querySelectorAll('#quick-examples button').forEach((button) => {
    button.disabled = value;
  });
  $('generate').textContent = value ? 'Generating…' : 'Generate with DeepSeek';
  $('generate').setAttribute('aria-busy', String(value));
  if (!value && live?.remaining === 0) $('generate').disabled = true;
}

function dirty() {
  $('character-count').textContent =
    `${$('request').value.length.toLocaleString('en')} / 2,000 characters`;
  $('result-content').replaceChildren(
    el('p', 'Input changed. Validate again to refresh the decision.', 'empty'),
  );
  $('candidate-origin').textContent = 'Edited';
  $('action-status').textContent = '';
}

function validate() {
  const result =
    $('policy').value === 'v2'
      ? reviewCandidateV2($('request').value, $('candidate').value)
      : reviewCandidate($('request').value, $('candidate').value);
  const container = $('result-content');
  container.replaceChildren();
  if (result.decision === 'rejected') {
    container.append(
      el('p', 'Rejected output', 'result-state rejected'),
      el(
        'p',
        'The candidate failed validation. Fix the issues before asking a person to rely on it.',
        'result-summary',
      ),
    );
    const list = el('ul', undefined, 'reasons');
    for (const issue of result.issues) list.append(el('li', `${issue.path}: ${issue.message}`));
    container.append(list);
    return;
  }
  container.append(
    el(
      'p',
      result.queue === 'escalation' ? 'Specialist review' : 'Standard review',
      `result-state ${result.queue}`,
    ),
  );
  container.append(el('p', result.candidate.summary, 'result-summary'));
  const facts = el('dl', undefined, 'result-facts');
  for (const [label, value] of [
    ['Category', result.candidate.category],
    ['Priority', result.candidate.priority],
    [
      'Specialist reason',
      result.candidate.reviewReason?.replaceAll('_', ' ') ?? 'V1 keyword policy',
    ],
    ['Decision', 'Human review required'],
  ]) {
    const cell = el('div');
    cell.append(el('dt', label), el('dd', value));
    facts.append(cell);
  }
  container.append(facts);
  const reasons = el('ul', undefined, 'reasons');
  result.reasons.forEach((reason) => reasons.append(el('li', reason)));
  container.append(reasons, el('p', 'Verified source quotes', 'quote-label'));
  result.candidate.evidence.forEach((quote) => container.append(el('blockquote', quote, 'quote')));
  if (result.candidate.reviewEvidence)
    container.append(
      el('p', 'Quote for specialist review', 'quote-label'),
      el('blockquote', result.candidate.reviewEvidence, 'quote'),
    );
}

function loadExample(id) {
  const sample = samples.find((entry) => entry.id === id);
  if (!sample || busy) return;
  $('example').value = id;
  $('request').value = sample.source;
  const raw = sample.candidates[$('policy').value];
  try {
    $('candidate').value = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    $('candidate').value = raw ?? '';
  }
  $('language').textContent = sample.language.toUpperCase();
  $('candidate-origin').textContent = 'Recorded DeepSeek';
  $('character-count').textContent = `${sample.source.length} / 2,000 characters`;
  $('action-status').textContent =
    'Saved response from the published synthetic experiment. No API call made.';
  document
    .querySelectorAll('#quick-examples button')
    .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.id === id)));
  validate();
}

function renderComparison(data) {
  const wrapper = $('comparison');
  wrapper.replaceChildren();
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', 'Scrollable policy comparison');
  const table = el('table');
  table.append(
    el(
      'caption',
      'Live DeepSeek calls · same 20 AI-authored synthetic inputs · provisional labels',
    ),
  );
  const head = el('thead');
  const header = el('tr');
  for (const label of ['Measured outcome', 'V1 · source keywords', 'V2 · review reason']) {
    const th = el('th', label);
    th.scope = 'col';
    header.append(th);
  }
  head.append(header);
  table.append(head);
  const v1 = data.v1.metrics;
  const v2 = data.v2.metrics;
  const ratio = (metric) =>
    metric.denominator ? `${metric.correct} / ${metric.denominator}` : 'Not scorable';
  const rows = [
    ['Valid outputs', `${v1.scorable} / ${v1.total}`, `${v2.scorable} / ${v2.total}`],
    ['Category matches · valid outputs', ratio(v1.category), ratio(v2.category)],
    ['Priority matches · valid outputs', ratio(v1.priority), ratio(v2.priority)],
    [
      'Missed specialist review',
      `${v1.escalation.missed} / ${v1.escalation.expected} expected`,
      `${v2.escalation.missed} / ${v2.escalation.expected} expected`,
    ],
    [
      'Unnecessary specialist review',
      `${v1.escalation.falsePositives} / ${v1.escalation.standardScorable} scorable`,
      `${v2.escalation.falsePositives} / ${v2.escalation.standardScorable} scorable`,
    ],
    [
      'Expected escalation · not scorable',
      String(v1.escalation.unscorable),
      String(v2.escalation.unscorable),
    ],
    [
      'Provider errors / skipped',
      `${v1.providerErrors} / ${data.v1.dataset.skipped}`,
      `${v2.providerErrors} / ${data.v2.dataset.skipped}`,
    ],
  ];
  const body = el('tbody');
  rows.forEach(([label, before, after]) => {
    const row = el('tr');
    const th = el('th', label);
    th.scope = 'row';
    row.append(th, el('td', before), el('td', after));
    body.append(row);
  });
  table.append(body);
  wrapper.append(table);
}

async function generate() {
  if (busy || !live) return;
  if ($('request').value.trim().length < 8) {
    $('action-status').textContent = 'Write a request with at least eight characters.';
    return;
  }
  setBusy(true);
  $('action-status').textContent =
    'Sending this request to DeepSeek. The key stays on the local server.';
  $('result-content').replaceChildren(el('p', 'Waiting for a new model response…', 'empty'));
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Playground-Token': live.token },
      body: JSON.stringify({ source: $('request').value, policy: $('policy').value }),
      signal: AbortSignal.timeout(55_000),
    });
    const data = await response.json();
    if (Number.isInteger(data.remaining)) live.remaining = data.remaining;
    if (!response.ok) throw new Error(data.error || 'Generation failed.');
    try {
      $('candidate').value = JSON.stringify(JSON.parse(data.output), null, 2);
    } catch {
      $('candidate').value = data.output;
    }
    $('candidate-origin').textContent = 'Live DeepSeek';
    $('action-status').textContent =
      `New response · ${data.latencyMs} ms · ${live.remaining} requests left in this local session.`;
    validate();
  } catch (error) {
    $('action-status').textContent =
      error.name === 'TimeoutError'
        ? 'Request timed out. No automatic retry was made.'
        : error.message;
    $('result-content').replaceChildren(
      el(
        'p',
        'Generation did not finish. Your input is preserved; no new decision was produced.',
        'empty',
      ),
    );
  } finally {
    setBusy(false);
  }
}

async function start() {
  const response = await fetch('data/demo.json');
  if (!response.ok)
    throw new Error('Cannot load recorded examples. Refresh the page or check your connection.');
  const data = await response.json();
  samples = data.samples;
  $('example').replaceChildren();
  samples.forEach((sample) => {
    const option = el(
      'option',
      `${sample.language.toUpperCase()} · ${sample.id.replaceAll('-', ' ')}`,
    );
    option.value = sample.id;
    $('example').append(option);
  });
  for (const [id, title, note] of [
    ['invoice-only', 'No refund requested', 'Negation · English'],
    ['hr-return-payment', 'Return a duplicate payment', 'Financial review · Croatian'],
    ['security-document', 'Security documentation', 'Information, not an incident'],
    ['injection-financial', 'Instructions in the source', 'Prompt injection attempt'],
  ]) {
    if (!samples.some((sample) => sample.id === id)) continue;
    const button = el('button', title);
    button.type = 'button';
    button.dataset.id = id;
    button.append(el('small', note));
    button.addEventListener('click', () => loadExample(id));
    $('quick-examples').append(button);
  }
  renderComparison(data.comparison);
  $('example').addEventListener('change', () => loadExample($('example').value));
  $('reset').addEventListener('click', () => loadExample($('example').value));
  $('policy').addEventListener('change', () => {
    $('policy-description').textContent =
      $('policy').value === 'v2'
        ? 'Separates urgency from the need for specialist review, with a supporting quote.'
        : 'Escalates urgent candidates and English keywords in the source. Negation and other languages can cause routing mistakes.';
    loadExample($('example').value);
  });
  $('request').addEventListener('input', dirty);
  $('candidate').addEventListener('input', dirty);
  $('validate').addEventListener('click', validate);
  $('generate').addEventListener('click', generate);
  setBusy(false);
  loadExample('invoice-only');
  if (location.hostname === '127.0.0.1' && location.protocol === 'http:') {
    try {
      const config = await fetch('/api/config');
      if (config.ok) {
        const value = await config.json();
        if (value.live) {
          live = value;
          $('generate').hidden = false;
          $('mode-name').textContent = 'Live DeepSeek available';
          $('mode-detail').textContent =
            'Generate from your own synthetic request. This local session allows up to 20 paid calls; credentials stay on the server.';
        }
      }
    } catch {
      /* The saved examples continue to work without a local model endpoint. */
    }
  }
}

start().catch((error) => {
  $('load-error').hidden = false;
  $('load-error').textContent = error.message;
});
