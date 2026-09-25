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

test('voxel tools: keys and buttons drive the depth layer, tool, colour and Depth Lock', async ({
  page,
}) => {
  await openApp(page);
  const tools = page.getByLabel('Voxel Builder tools');
  const depth = tools.getByLabel(/Active depth layer/);
  await expect(depth).toHaveAttribute('aria-label', 'Active depth layer 0');
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  await page.keyboard.press('q');
  await expect(depth).toHaveAttribute('aria-label', 'Active depth layer +1');
  await tools.getByRole('button', { name: 'Depth layer down (Q)' }).click();
  await tools.getByRole('button', { name: 'Depth layer down (Q)' }).click();
  await expect(depth).toHaveAttribute('aria-label', 'Active depth layer −1');

  await page.keyboard.press('x');
  await expect(tools.getByRole('button', { name: 'Erase' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await tools.getByRole('button', { name: 'Paint' }).click();
  await expect(tools.getByRole('button', { name: 'Paint' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await tools.getByRole('button', { name: 'Magenta' }).click();
  await expect(tools.getByRole('button', { name: 'Magenta' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.keyboard.press('l');
  await expect(tools.getByRole('button', { name: /Depth Lock off/ })).toBeVisible();
  await expect(tools).toContainText('0 voxels');
});

test('air draw tools: X toggles the eraser; colour, width and glow buttons work', async ({
  page,
}) => {
  await openApp(page);
  await page.keyboard.press('3');
  const tools = page.getByLabel('Air Draw tools');
  await expect(tools.getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('x');
  await expect(tools.getByRole('button', { name: 'Eraser' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await tools.getByRole('button', { name: 'Pen' }).click();
  await tools.getByRole('button', { name: 'Magenta' }).click();
  await expect(tools.getByRole('button', { name: 'Magenta' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await tools.getByRole('button', { name: 'Thick' }).click();
  await expect(tools.getByRole('button', { name: 'Thick' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await tools.getByRole('button', { name: 'Glow on' }).click();
  await expect(tools.getByRole('button', { name: 'Glow off' })).toBeVisible();
  await expect(tools).toContainText('0 strokes');
});
