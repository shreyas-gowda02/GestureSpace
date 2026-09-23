import { expect, test } from '@playwright/test';

test('app shell renders with all seven experiences', async ({ page }) => {
  await page.goto('/');
  const dock = page.getByRole('navigation', { name: 'Experiences' }).getByRole('button');
  await expect(dock).toHaveCount(7);
});

test('number keys switch experiences', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('3');
  await expect(page.getByRole('button', { name: /Air Draw/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('camera: enable → running → stop → start, never duplicating streams or loops', async ({
  page,
}) => {
  await page.goto('/');
  // Nothing is requested before the click (§24).
  await expect(page.getByText('Camera off')).toBeVisible();

  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByText('Camera on')).toBeVisible();

  await page.getByRole('button', { name: 'Stop camera' }).click();
  await expect(page.getByRole('heading', { name: 'Camera stopped' })).toBeVisible();
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByText('Camera on')).toBeVisible();

  const counters = await page.evaluate(() => window.__gs_debug);
  expect(counters?.renderersCreated).toBe(1);
  expect(counters?.cameraStreamsActive).toBe(1);
  expect(counters?.renderLoopsActive).toBe(1);
});
