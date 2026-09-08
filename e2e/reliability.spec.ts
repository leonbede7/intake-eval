import { test, expect } from '@playwright/test';

test('failure lab is reachable, readable on mobile and exposes the semantic limitation', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4317/')) external.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Failure lab', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('What happens when the response breaks?');
  await expect(page.locator('.case')).toHaveCount(15);
  await expect(page.locator('.counts')).toContainText('14 / 14');
  await page.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('details')).toHaveAttribute('open', '');
  await expect(page.locator('details')).toContainText('successfully exported');
  await expect(page.locator('details')).toContainText('gives an error');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(external).toEqual([]);
});
