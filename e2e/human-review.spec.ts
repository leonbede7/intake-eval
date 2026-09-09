import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const key = 'intake-eval-human-review-v1';
async function initial(page: Page) {
  await page.locator('#initial-category').selectOption('other');
  await page.locator('#initial-priority').selectOption('normal');
  await page.locator('#initial-escalation').selectOption('unsure');
  await page.getByRole('button', { name: 'Save assessment & reveal response' }).click();
}
async function finish(page: Page, notes = 'The request leaves room for interpretation.') {
  await page.locator('#summary-rating').selectOption('unclear');
  await page.locator('#review-disposition').selectOption('unresolved');
  await page.locator('#review-notes').fill(notes);
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
}
test('source-first review, skip, resume and revision history preserve distinct judgments', async ({
  page,
}) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4317/')) external.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('link', { name: 'Human review', exact: true }).click();
  await expect(page.locator('#review-progress')).toHaveText('0 / 20 reviewed');
  await expect(page.locator('#candidate-stage')).toBeHidden();
  await expect(page.locator('#candidate-json')).toHaveText('');
  await page.locator('#initial-category').selectOption('other');
  await page.locator('#next-case').click();
  await expect(page.locator('#case-title')).toHaveText('Request 02 / 20');
  await page.locator('#previous-case').click();
  await expect(page.locator('#initial-category')).toHaveValue('other');
  await initial(page);
  await expect(page.locator('#candidate-stage')).toBeVisible();
  await expect(page.locator('#label-comparison')).toBeHidden();
  await page.locator('#final-category').selectOption('billing');
  await finish(page);
  await expect(page.locator('#label-comparison')).toBeVisible();
  await expect(page.locator('#review-progress')).toHaveText('1 / 20 reviewed');
  await page.reload();
  await page.locator('#review-case').selectOption('0');
  await expect(page.locator('#initial-record-text')).toContainText('Other');
  await expect(page.locator('#final-category')).toHaveValue('billing');
  await page.locator('#review-notes').fill('Updated judgment after checking the request again.');
  await page.getByRole('button', { name: 'Save revised review' }).click();
  await expect(page.locator('#review-history li')).toHaveCount(2);
  await page.locator('#next-case').click();
  await expect(page.locator('#candidate-json')).toHaveText('');
  await expect(page.locator('#provisional-values')).toHaveText('');
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
test('reviews round trip through download and explicit import replacement; hostile notes stay text', async ({
  page,
}) => {
  await page.goto('/review.html');
  await initial(page);
  const note = '<img src=x onerror="window.injected=true"> Uncertain about the requested action.';
  await finish(page, note);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reviews' }).click();
  const download = await waiting;
  const path = await download.path();
  expect(path).toBeTruthy();
  const buffer = await readFile(path!);
  const exported = JSON.parse(buffer.toString());
  expect(exported.entries[0].revisions[0].notes).toBe(note);
  await page.locator('#reviewer-label').fill('Current session');
  await page
    .locator('#import-review')
    .setInputFiles({ name: 'reviews.json', mimeType: 'application/json', buffer });
  await expect(page.locator('#import-confirm')).toBeVisible();
  await expect(page.locator('#reviewer-label')).toHaveValue('Current session');
  await page.getByRole('button', { name: 'Keep current session' }).click();
  await expect(page.locator('#reviewer-label')).toHaveValue('Current session');
  await page
    .locator('#import-review')
    .setInputFiles({ name: 'reviews.json', mimeType: 'application/json', buffer });
  await page.getByRole('button', { name: 'Replace with imported reviews' }).click();
  await expect(page.locator('#reviewer-label')).toHaveValue('');
  await expect(page.locator('#review-history')).toContainText(note);
  await expect(page.locator('#review-history img')).toHaveCount(0);
  expect(await page.evaluate(() => Object.hasOwn(window, 'injected'))).toBe(false);
});
test('invalid, incompatible and oversized imports leave current work intact', async ({ page }) => {
  await page.goto('/review.html');
  await page.locator('#reviewer-label').fill('Keep me');
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  for (const buffer of [
    Buffer.from('{oops'),
    Buffer.from(JSON.stringify({ ...saved, version: 2 })),
    Buffer.from(JSON.stringify({ ...saved, dataset: { ...saved.dataset, hash: 'changed' } })),
    Buffer.alloc(16777217, 32),
  ]) {
    await page
      .locator('#import-review')
      .setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer });
    await expect(page.locator('#review-error')).toBeVisible();
    await expect(page.locator('#import-confirm')).toBeHidden();
    await expect(page.locator('#reviewer-label')).toHaveValue('Keep me');
    expect(
      await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).reviewer.label, key),
    ).toBe('Keep me');
  }
});
test('blocked storage keeps review usable and downloadable without pretending it was saved', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
  });
  await page.goto('/review.html');
  await expect(page.locator('#storage-state')).toContainText('memory only');
  await initial(page);
  await finish(page);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reviews' }).click();
  const dl = await waiting;
  expect(JSON.parse(await readFile((await dl.path())!, 'utf8')).entries[0].revisions).toHaveLength(
    1,
  );
});
test('failed storage writes retain an honest fallback', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Full', 'QuotaExceededError');
    };
  });
  await page.goto('/review.html');
  await page.locator('#reviewer-label').fill('Memory only');
  await expect(page.locator('#storage-state')).toContainText('memory only');
  await initial(page);
  await finish(page);
  await expect(page.locator('#review-progress')).toContainText('1 / 20');
});

test('corrupted stored data is preserved while new work runs in memory', async ({ page }) => {
  await page.addInitScript((storageKey) => localStorage.setItem(storageKey, '{broken-json'), key);
  await page.goto('/review.html');
  await expect(page.locator('#review-error')).toContainText('Existing data has not been replaced');
  await initial(page);
  await finish(page);
  expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)).toBe(
    '{broken-json',
  );
  await expect(page.locator('#storage-state')).toContainText('memory only');
});

test('all 20 requests can be reviewed, exported and resumed without fabricating resolved cases', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/review.html');
  await page.locator('#reviewer-label').fill('Automated test only');
  for (let i = 0; i < 20; i++) {
    await initial(page);
    await finish(page, 'Automated workflow test, not a human judgment.');
    if (i < 19) await page.locator('#next-case').click();
  }
  await expect(page.locator('#review-progress')).toHaveText('20 / 20 reviewed');
  await expect(page.locator('#result-counts')).toContainText('20 / 20Unresolved');
  await page.reload();
  await expect(page.locator('#review-progress')).toHaveText('20 / 20 reviewed');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reviews' }).click();
  const file = await waiting;
  const record = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(
    record.entries.filter((r: { revisions: unknown[] }) => r.revisions.length === 1),
  ).toHaveLength(20);
});

test('served review data matches the public frozen cases, V2 captures and content fingerprint', async ({
  request,
}) => {
  const response = await request.get('/data/review.json');
  expect(response.ok()).toBe(true);
  const data = await response.json();
  const cases = JSON.parse(await readFile('fixtures/routing-comparison.json', 'utf8'));
  const captures = JSON.parse(
    await readFile('docs/results/routing-comparison/v2/candidates.json', 'utf8'),
  );
  expect(data.samples).toHaveLength(20);
  for (const sample of data.samples) {
    const source = cases.find((c: { id: string }) => c.id === sample.id);
    expect(sample).toEqual({
      id: source.id,
      source: source.source,
      language: source.language,
      expected: source.expected,
      candidate: captures.find((c: { id: string }) => c.id === sample.id).output,
    });
  }
  expect(data.hash).toBe(
    createHash('sha256')
      .update(JSON.stringify({ id: data.id, samples: data.samples }))
      .digest('hex'),
  );
});
test('320px layout, keyboard review and summary tables remain usable', async ({ page }) => {
  await page.goto('/review.html');
  await page.locator('#initial-category').focus();
  await page.keyboard.press('o');
  await page.keyboard.press('Tab');
  await page.keyboard.press('n');
  await page.keyboard.press('Tab');
  await page.keyboard.press('n');
  await page.getByRole('button', { name: 'Save assessment & reveal response' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#candidate-stage')).toBeVisible();
  await finish(page);
  await page.locator('#comparison-details > summary').click();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('#review-case')).toBeVisible();
  }
});
