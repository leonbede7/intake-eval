import { test, expect } from '@playwright/test';

test('recorded examples show the v1/v2 routing difference', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#result-content')).toContainText('Standard review');
  await page.locator('#policy').selectOption('v1');
  await expect(page.locator('#result-content')).toContainText('Specialist review');
  await page.locator('#example').selectOption('hr-return-payment');
  await expect(page.locator('#result-content')).toContainText('Standard review');
  await page.locator('#policy').selectOption('v2');
  await expect(page.locator('#result-content')).toContainText('Specialist review');
  await expect(page.locator('#result-content')).toContainText('financial action');
});

test('editing source clears stale results and invented evidence is rejected', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#candidate')).not.toHaveValue('');
  await page
    .locator('#request')
    .fill('This completely different source contains no matching quotes.');
  await expect(page.locator('#result-content')).toContainText('Input changed');
  await page.locator('#validate').click();
  await expect(page.locator('#result-content')).toContainText('Rejected output');
  await expect(page.locator('#result-content')).toContainText('does not occur exactly');
  await page.locator('#reset').click();
  await expect(page.locator('#result-content')).toContainText('Standard review');
});

test('model text renders as text and does not execute HTML', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#candidate')).not.toHaveValue('');
  const candidate = JSON.parse(await page.locator('#candidate').inputValue());
  candidate.summary = '<img src=x onerror="window.injected=true">';
  await page.locator('#candidate').fill(JSON.stringify(candidate));
  await page.locator('#validate').click();
  await expect(page.locator('#result-content')).toContainText('<img src=x');
  await expect(page.locator('#result-content img')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { injected?: boolean }).injected),
  ).toBeUndefined();
});

test('public mode makes no generation calls and presents real comparison counts', async ({
  page,
}) => {
  const generation: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/generate')) generation.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('#comparison table')).toBeVisible();
  await expect(page.locator('#generate')).toBeHidden();
  await expect(page.locator('#comparison')).toContainText('4 / 12 scorable');
  await expect(page.locator('#comparison')).toContainText('0 / 12 scorable');
  expect(generation).toEqual([]);
});

test('local generation UI handles a successful response and failed follow-up', async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { live: true, token: 'test-session', remaining: 20 } }),
  );
  let calls = 0;
  await page.route('**/api/generate', async (route) => {
    calls++;
    expect(route.request().headers()['x-playground-token']).toBe('test-session');
    if (calls === 2)
      return route.fulfill({
        status: 502,
        json: { error: 'Model request failed: TIMEOUT. No retry was made.', remaining: 18 },
      });
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        output: JSON.stringify({
          summary: 'Customer needs a duplicate payment refund.',
          category: 'billing',
          priority: 'normal',
          evidence: [body.source],
          reviewReason: 'financial_action',
          reviewEvidence: body.source,
        }),
        latencyMs: 42,
        remaining: 19,
      },
    });
  });
  await page.goto('/');
  await expect(page.locator('#generate')).toBeVisible();
  await page.locator('#request').fill('Please return the second payment for my subscription.');
  await page.locator('#generate').click();
  await expect(page.locator('#candidate-origin')).toHaveText('Live DeepSeek');
  await expect(page.locator('#result-content')).toContainText('Specialist review');
  await expect(page.locator('#action-status')).toContainText('19 requests left');
  await page.locator('#generate').click();
  await expect(page.locator('#action-status')).toContainText('TIMEOUT');
  await expect(page.locator('#result-content')).toContainText('no new decision');
  expect(calls).toBe(2);
});

test('mobile view has no page overflow and all form controls remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#result-content')).toContainText('Standard review');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#example').selectOption('hr-return-payment');
  await page.locator('#validate').click();
  await expect(page.locator('#result-content')).toContainText('Specialist review');
  await page.screenshot({ path: 'test-results/playground-mobile.png', fullPage: true });
});

test('desktop has no script errors and provides a keyboard-accessible skip link', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/');
  await expect(page.locator('#result-content')).toContainText('Standard review');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip')).toBeFocused();
  await page.locator('h1').click();
  await page.screenshot({ path: 'test-results/playground-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
