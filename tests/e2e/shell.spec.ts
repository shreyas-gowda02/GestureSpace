import { expect, test, type Page } from '@playwright/test';

/**
 * Open the app and wait until it takes input. `goto` resolves on `load`, which fires before
 * React's first effects run — a key pressed then is lost because the keyboard listener isn't
 * attached yet. The core is created in that same effect flush, so once it exists, keys work.
 */
async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gs_debug?.coreCreated === 1);
}

test('app shell renders with all seven experiences', async ({ page }) => {
  await openApp(page);
  const dock = page.getByRole('navigation', { name: 'Experiences' }).getByRole('button');
  await expect(dock).toHaveCount(7);
});

test('number keys switch experiences', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('3');
  await expect(page.getByRole('button', { name: /Air Draw/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('camera: enable → running → stop → start, never duplicating streams or loops', async ({
  page,
}) => {
  await openApp(page);
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
  expect(counters?.trackersCreated ?? 0).toBeLessThanOrEqual(1);
});

test('hand tracker loads once and the debug panel reports it', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByText('Show your hand to the camera')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('`');
  await expect(page.getByLabel('Debug panel')).toContainText(/ready · (GPU|CPU)/);
  const counters = await page.evaluate(() => window.__gs_debug);
  expect(counters?.trackersCreated).toBe(1);
  expect(counters?.visionWorkers ?? 0).toBeLessThanOrEqual(1);
});

test('switching through all seven experiences never duplicates the core or renderer', async ({
  page,
}) => {
  await openApp(page);
  for (const key of ['1', '2', '3', '4', '5', '6', '7', '1']) await page.keyboard.press(key);
  await expect(page.getByRole('button', { name: /Voxel Builder/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const counters = await page.evaluate(() => window.__gs_debug);
  expect(counters?.coreCreated).toBe(1);
  expect(counters?.renderersCreated).toBe(1);
  expect(counters?.modeSwitches).toBeGreaterThanOrEqual(8);
});
