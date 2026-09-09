import { categories, priorities } from './lib/triage.js';
import { reviewCandidateV2 } from './lib/triage-v2.js';
import {
  createReviewSession,
  beginReview,
  finishReview,
  parseReviewSession,
  reviewSummary,
} from './lib/human-review.js';

const $ = (id) => document.getElementById(id);
const storageKey = 'intake-eval-human-review-v1';
const labels = {
  billing: 'Billing',
  technical: 'Technical',
  account: 'Account',
  other: 'Other',
  normal: 'Normal',
  urgent: 'Urgent',
  yes: 'Yes',
  no: 'No',
  unsure: 'Not sure',
  accurate: 'Accurate',
  partly_accurate: 'Partly accurate',
  inaccurate: 'Inaccurate',
  unclear: 'Unclear',
  acceptable: 'Acceptable',
  needs_correction: 'Needs correction',
  unresolved: 'Unresolved',
};
const label = (value) => labels[value] ?? value;
let dataset,
  session,
  current = 0,
  pendingImport = null,
  storageAvailable = true;
function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}
const sample = () => dataset.samples[current];
const entry = () => session.entries.find((row) => row.id === sample().id);
function announce(message) {
  $('review-message').textContent = message;
}
function clearError() {
  $('review-error').hidden = true;
  $('review-error').textContent = '';
}
function error(message) {
  $('review-error').textContent = message;
  $('review-error').hidden = false;
  $('review-error').tabIndex = -1;
  $('review-error').focus();
}
function storageStatus() {
  $('storage-state').textContent = storageAvailable
    ? 'Saved in this browser only. Download a copy before clearing browser data or changing devices.'
    : 'Not saved to browser storage. Work is in memory only. Download reviews before leaving this page.';
  $('storage-state').classList.toggle('unsaved', !storageAvailable);
}
function persist() {
  session.savedAt = new Date().toISOString();
  if (storageAvailable) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(session));
    } catch {
      storageAvailable = false;
    }
  }
  storageStatus();
}
const assessmentText = (a) =>
  `${label(a.category)} · ${label(a.priority)} priority · Specialist review: ${label(a.escalation)}`;
function buildAssessmentFields(container, prefix) {
  for (const [key, title, values] of [
    ['category', 'Category', categories],
    ['priority', 'Priority', priorities],
    ['escalation', 'Specialist review', ['yes', 'no']],
  ]) {
    const box = element('div');
    const titleNode = element('label', title);
    titleNode.htmlFor = `${prefix}-${key}`;
    const select = element('select');
    select.id = `${prefix}-${key}`;
    select.required = true;
    for (const value of ['', ...values, 'unsure']) {
      const option = element('option', value ? label(value) : 'Choose an assessment');
      option.value = value;
      select.append(option);
    }
    select.addEventListener('change', () => {
      entry().draft[key] = select.value;
      persist();
    });
    box.append(titleNode, select);
    $(container).append(box);
  }
}
function renderProgress() {
  const done = session.entries.filter((r) => r.revisions.length).length;
  $('review-progress').textContent = `${done} / ${dataset.samples.length} reviewed`;
  $('review-meter').max = dataset.samples.length;
  $('review-meter').value = done;
  $('review-case').replaceChildren(
    ...dataset.samples.map((s, i) => {
      const row = session.entries.find((e) => e.id === s.id);
      const status = row.revisions.length
        ? label(row.revisions.at(-1).disposition)
        : row.initial
          ? 'In progress'
          : 'Not reviewed';
      const option = element(
        'option',
        `${String(i + 1).padStart(2, '0')} · ${s.language.toUpperCase()} · ${status}`,
      );
      option.value = String(i);
      return option;
    }),
  );
  $('review-case').value = String(current);
}
function renderCandidate(row, s) {
  const result = reviewCandidateV2(s.source, s.candidate);
  $('initial-record-text').textContent =
    `${assessmentText(row.initial)}. Saved ${new Date(row.initial.savedAt).toLocaleString()}.`;
  $('candidate-json').textContent = s.candidate;
  $('candidate-facts').replaceChildren();
  $('candidate-evidence').replaceChildren();
  if (result.decision === 'rejected') {
    $('candidate-summary').textContent =
      'This recorded candidate failed validation. Inspect its JSON and describe the issue in your review.';
    $('candidate-validation').textContent =
      `Rejected: ${result.issues.map((i) => i.message).join(' ')}`;
  } else {
    const c = result.candidate;
    $('candidate-summary').textContent = c.summary;
    for (const [title, value] of [
      ['Category', label(c.category)],
      ['Priority', label(c.priority)],
      ['Specialist review', result.queue === 'escalation' ? 'Yes' : 'No'],
      ['Review reason', c.reviewReason.replaceAll('_', ' ')],
    ]) {
      const box = element('div');
      box.append(element('dt', title), element('dd', value));
      $('candidate-facts').append(box);
    }
    for (const quote of [
      ...new Set([...c.evidence, ...(c.reviewEvidence ? [c.reviewEvidence] : [])]),
    ])
      $('candidate-evidence').append(element('li', quote));
    $('candidate-validation').textContent =
      'Validator: review required. Structure and exact quotes passed. Summary truthfulness still needs your judgment.';
  }
  for (const key of ['category', 'priority', 'escalation'])
    $(`final-${key}`).value = row.draft[key];
  $('summary-rating').value = row.draft.summary;
  $('review-disposition').value = row.draft.disposition;
  $('review-notes').value = row.draft.notes;
  $('review-notes').required =
    row.draft.disposition !== '' && row.draft.disposition !== 'acceptable';
  $('save-final').textContent = row.revisions.length ? 'Save revised review' : 'Save review';
  $('revision-count').textContent = row.revisions.length
    ? `${row.revisions.length} saved version${row.revisions.length === 1 ? '' : 's'}. Draft changes stay separate until saved.`
    : '';
  $('label-comparison').hidden = !row.revisions.length;
  if (row.revisions.length) {
    const final = row.revisions.at(-1);
    $('provisional-values').textContent = assessmentText({
      ...s.expected,
      escalation: s.expected.escalation ? 'yes' : 'no',
    });
    const differences = ['category', 'priority', 'escalation'].filter(
      (key) =>
        final[key] !==
        (key === 'escalation' ? (s.expected.escalation ? 'yes' : 'no') : s.expected[key]),
    );
    $('comparison-values').textContent = differences.length
      ? `Your latest saved review differs or is uncertain on: ${differences.map((k) => (k === 'escalation' ? 'specialist review' : k)).join(', ')}.`
      : 'Your latest saved review agrees with all three provisional labels.';
    $('review-history').replaceChildren(
      ...row.revisions.map((r, i) =>
        element(
          'li',
          `Version ${i + 1} · ${new Date(r.savedAt).toLocaleString()} · ${assessmentText(r)}. Summary: ${label(r.summary)}. Decision: ${label(r.disposition)}.${r.notes ? ` Notes: ${r.notes}` : ''}`,
        ),
      ),
    );
  }
}
function renderResults() {
  const r = reviewSummary(session, dataset);
  const who = session.reviewer.label.trim() || 'Unnamed reviewer';
  $('results-context').textContent =
    `${who} · ${session.reviewer.relationship === 'project_author' ? 'Project author review' : 'Self-reported visitor review'}. ${r.completed === 0 ? 'No saved human judgments yet.' : `${r.total - r.completed} requests still need a saved review.`}`;
  $('result-counts').replaceChildren(
    ...[
      [`${r.completed} / ${r.total}`, 'Reviews saved'],
      [`${r.acceptable} / ${r.completed}`, 'Acceptable'],
      [`${r.needsCorrection} / ${r.completed}`, 'Needs correction'],
      [`${r.unresolved} / ${r.completed}`, 'Unresolved'],
    ].map(([value, title]) => {
      const box = element('div');
      box.append(element('strong', value), element('span', title));
      return box;
    }),
  );
  $('summary-counts').textContent = Object.entries(r.summaries)
    .map(([key, count]) => `${label(key)}: ${count} / ${r.completed}`)
    .join(' · ');
  $('agreement-tables').replaceChildren();
  for (const basis of ['initial', 'final'])
    for (const target of ['model', 'provisional']) {
      const table = element('table');
      table.append(
        element(
          'caption',
          `${basis === 'initial' ? 'Initial assessments' : 'Final assessments'} vs ${target === 'model' ? 'recorded model' : 'AI-authored labels'}`,
        ),
      );
      const head = element('thead'),
        header = element('tr');
      for (const title of ['Field', 'Agree', 'Disagree', 'Excluded']) {
        const th = element('th', title);
        th.scope = 'col';
        header.append(th);
      }
      head.append(header);
      table.append(head);
      const body = element('tbody');
      for (const c of r.comparisons.filter((c) => c.basis === basis && c.target === target)) {
        const tr = element('tr'),
          th = element(
            'th',
            c.field === 'escalation'
              ? 'Specialist review'
              : c.field === 'category'
                ? 'Category'
                : 'Priority',
          );
        th.scope = 'row';
        tr.append(
          th,
          element('td', `${c.agree} / ${c.denominator}`),
          element('td', `${c.disagree} / ${c.denominator}`),
          element('td', String(c.excluded)),
        );
        body.append(tr);
      }
      table.append(body);
      $('agreement-tables').append(table);
    }
}
function renderCase(focus = false) {
  clearError();
  renderProgress();
  const row = entry(),
    s = sample();
  $('case-title').textContent =
    `Request ${String(current + 1).padStart(2, '0')} / ${dataset.samples.length}`;
  $('review-language').textContent = s.language === 'hr' ? 'Croatian' : 'English';
  $('review-source').textContent = s.source;
  $('initial-form').hidden = !!row.initial;
  $('candidate-stage').hidden = !row.initial;
  // Clear content as well as hiding it when moving to an unassessed case.
  for (const id of [
    'candidate-summary',
    'candidate-facts',
    'candidate-evidence',
    'candidate-json',
    'candidate-validation',
    'initial-record-text',
    'provisional-values',
    'comparison-values',
    'review-history',
  ])
    $(id).replaceChildren();
  $('label-comparison').hidden = true;
  for (const key of ['category', 'priority', 'escalation'])
    $(`initial-${key}`).value = row.draft[key];
  if (row.initial) renderCandidate(row, s);
  $('previous-case').disabled = current === 0;
  $('next-case').textContent =
    current === dataset.samples.length - 1
      ? 'Back to first request'
      : row.revisions.length
        ? 'Next request →'
        : 'Skip / next request →';
  renderResults();
  if (focus) $('case-title').focus();
}
function replaceEntry(row) {
  session.entries[session.entries.findIndex((e) => e.id === row.id)] = row;
  persist();
}
async function start() {
  const response = await fetch('data/review.json');
  if (!response.ok) throw new Error('Could not load the review cases. Reload to try again.');
  dataset = await response.json();
  session = createReviewSession(dataset);
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) session = parseReviewSession(JSON.parse(saved), dataset);
  } catch {
    storageAvailable = false;
    error(
      'Previous browser data could not be loaded, or storage is unavailable. Existing data has not been replaced. This session will use memory only; download your reviews to keep them.',
    );
  }
  buildAssessmentFields('initial-fields', 'initial');
  buildAssessmentFields('final-fields', 'final');
  $('reviewer-label').value = session.reviewer.label;
  $('reviewer-role').value = session.reviewer.relationship;
  for (const id of ['reviewer-label', 'reviewer-role'])
    $(id).addEventListener('input', () => {
      session.reviewer.label = $('reviewer-label').value;
      session.reviewer.relationship = $('reviewer-role').value;
      persist();
      renderResults();
    });
  for (const [id, key] of [
    ['summary-rating', 'summary'],
    ['review-disposition', 'disposition'],
    ['review-notes', 'notes'],
  ])
    $(id).addEventListener('input', () => {
      entry().draft[key] = $(id).value;
      $('review-notes').required =
        entry().draft.disposition !== '' && entry().draft.disposition !== 'acceptable';
      persist();
    });
  $('initial-form').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      replaceEntry(beginReview(entry()));
      renderCase();
      $('candidate-title').focus();
      announce('Initial assessment saved. The recorded response is now visible.');
    } catch (e) {
      error(e.message);
    }
  });
  $('final-form').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      replaceEntry(finishReview(entry(), sample()));
      renderCase();
      $('comparison-title').focus();
      announce(
        'Review saved. You can compare the provisional labels or continue to the next request.',
      );
    } catch (e) {
      error(e.message);
    }
  });
  $('review-case').addEventListener('change', () => {
    current = Number($('review-case').value);
    renderCase(true);
  });
  $('previous-case').addEventListener('click', () => {
    current = Math.max(0, current - 1);
    renderCase(true);
  });
  $('next-case').addEventListener('click', () => {
    current = (current + 1) % dataset.samples.length;
    renderCase(true);
  });
  $('export-review').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(session, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = element('a');
    a.href = url;
    a.download = `intake-eval-reviews-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('Review file prepared for download. Nothing was uploaded.');
  });
  $('import-review').addEventListener('change', async () => {
    pendingImport = null;
    $('import-confirm').hidden = true;
    clearError();
    const file = $('import-review').files?.[0];
    if (!file) return;
    try {
      if (file.size > 16777216) throw new Error('Choose a review JSON file smaller than 16 MiB.');
      pendingImport = parseReviewSession(JSON.parse(await file.text()), dataset);
      const completed = pendingImport.entries.filter((e) => e.revisions.length).length;
      $('import-description').textContent =
        `This file contains ${completed} saved reviews for this dataset. Reviewer: ${pendingImport.reviewer.label || 'Unnamed'}. It will replace the current session, including drafts.`;
      $('import-confirm').hidden = false;
      $('import-title').focus();
    } catch (e) {
      error(
        `Import failed. ${e instanceof SyntaxError ? 'The file is not valid JSON. Your current work was not replaced.' : e.message}`,
      );
    } finally {
      $('import-review').value = '';
    }
  });
  $('cancel-import').addEventListener('click', () => {
    pendingImport = null;
    $('import-confirm').hidden = true;
    $('import-review').focus();
    announce('Import cancelled. Current reviews kept.');
  });
  $('confirm-import').addEventListener('click', () => {
    if (!pendingImport) return;
    session = pendingImport;
    pendingImport = null;
    current = 0;
    $('import-confirm').hidden = true;
    $('reviewer-label').value = session.reviewer.label;
    $('reviewer-role').value = session.reviewer.relationship;
    persist();
    renderCase(true);
    announce('Imported reviews loaded. Reviewer identity is self-reported.');
  });
  current = Math.max(
    0,
    dataset.samples.findIndex((s) => !session.entries.find((e) => e.id === s.id).revisions.length),
  );
  $('review-app').hidden = false;
  renderCase();
  storageStatus();
  if (!storageAvailable)
    error(
      'Browser storage could not be loaded. Existing data has not been replaced. Download this session before leaving to keep your work.',
    );
}
start().catch((e) => error(e.message || 'The review tool could not start. Reload to try again.'));
