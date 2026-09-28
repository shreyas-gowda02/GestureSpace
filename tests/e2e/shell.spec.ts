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

test('spatial panel: pictures, camera snapshot, live camera and your own picture', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await openApp(page);
  await page.keyboard.press('2');
  const pressed = (name: string | RegExp) =>
    expect(page.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');

  // Camera content waits for the camera.
  await expect(page.getByRole('button', { name: 'Take a camera snapshot' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Live camera' })).toBeDisabled();
  await pressed('Aurora');
  await page.getByRole('button', { name: 'Sunset' }).click();
  await pressed('Sunset');

  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByText('Camera on')).toBeVisible();
  await page.getByRole('button', { name: 'Take a camera snapshot' }).click();
  await pressed('Take another snapshot');
  await page.getByRole('button', { name: 'Live camera' }).click();
  await pressed('Live camera');
  await page.getByRole('button', { name: 'Animated' }).click();
  await pressed('Animated');

  // A 1×1 PNG from "the user's computer".
  await page.locator('input[type="file"]').setInputFiles({
    name: 'dot.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await pressed(/Your picture: dot\.png/);
  await page.getByRole('button', { name: 'Synthwave' }).click();
  await pressed('Synthwave');
  expect(errors).toEqual([]);
});

test('hand strings: thread styles and trails switch without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await openApp(page);
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByText('Camera on')).toBeVisible();
  await page.keyboard.press('4');
  const pressed = (name: string) =>
    expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await pressed('Web');
  await pressed('Short');
  for (const name of ['Full mesh', 'Skeleton', 'Web']) {
    await page.getByRole('button', { name, exact: true }).click();
    await pressed(name);
  }
  for (const name of ['Long', 'Off', 'Short']) {
    await page.getByRole('button', { name, exact: true }).click();
    await pressed(name);
  }
  await page.getByRole('button', { name: /Settle the threads/ }).click();
  expect(errors).toEqual([]);
});

/** Collects page errors; opens the app with the (fake) camera on. */
async function openWithCamera(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await openApp(page);
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByText('Camera on')).toBeVisible();
  return errors;
}

// The lens / portal shaders are heavy for the headless browser's software GPU (frames are slow,
// and every click waits for frames), so these two get more time than the 30 s default.
test('filter lab: every filter and source switches without errors', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await openWithCamera(page);
  const pressed = (name: string) =>
    expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('5');
  await pressed('Thermal');
  for (const name of ['None', 'Sketch', 'Pixelate', 'Glitch', 'Red channel', 'Edge', 'Blur']) {
    await page.getByRole('button', { name, exact: true }).click();
    await pressed(name);
  }
  for (const name of ['Cartoon', 'Rainbow', 'Invert', 'RGB split', 'Pop art']) {
    await page.getByRole('button', { name, exact: true }).click();
    await pressed(name);
  }
  await page.keyboard.press('ArrowRight'); // Pop art → None
  await pressed('None');
  await page.getByRole('button', { name: 'Frozen', exact: true }).click();
  await pressed('Frozen');
  await page.getByRole('button', { name: 'Picture', exact: true }).click();
  await pressed('Picture');
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await pressed('Live');
  expect(errors).toEqual([]);
});

test('portal: every world switches without errors; Reset shuts it', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await openWithCamera(page);
  const pressed = (name: string) =>
    expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('6');
  await pressed('Nebula');
  await expect(page.getByText(/Shut — pinch both ends/)).toBeVisible();
  for (const name of ['Other World', 'Inverted Reality', 'Picture']) {
    await page.getByRole('button', { name, exact: true }).click();
    await pressed(name);
  }
  await page.getByRole('button', { name: /Reset portal/ }).click();
  expect(errors).toEqual([]);
});

test('3D object lab: make every shape; copy, delete, colour, look, clear and undo', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = await openWithCamera(page);
  const pressed = (name: string) =>
    expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  const count = page.locator('.gs-toolpanel__count');
  await page.keyboard.press('7');
  await expect(count).toHaveText('0 objects · 0 selected');
  for (const name of ['Cube', 'Sphere', 'Cylinder', 'Plane', 'Donut']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await expect(count).toHaveText('5 objects · 1 selected');
  await page.keyboard.press('d');
  await expect(count).toHaveText('6 objects · 1 selected');
  await page.getByRole('button', { name: 'Magenta', exact: true }).click();
  await pressed('Magenta');
  await page.getByRole('button', { name: 'Glass', exact: true }).click();
  await pressed('Glass');
  await page.getByRole('button', { name: 'Add to selection: off' }).click();
  await expect(page.getByRole('button', { name: 'Add to selection: on' })).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(count).toHaveText('5 objects · 0 selected');
  await expect(page.getByRole('button', { name: /^Copy/ })).toBeDisabled();
  await page.keyboard.press('Control+z');
  await expect(count).toHaveText('6 objects · 0 selected');
  await page.keyboard.press('c');
  await expect(count).toHaveText('0 objects · 0 selected');
  await page.keyboard.press('Control+z');
  await expect(count).toHaveText('6 objects · 0 selected');
  expect(errors).toEqual([]);
});
