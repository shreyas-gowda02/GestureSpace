import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Open the app and wait until it takes input. `goto` resolves on `load`, which fires before
 * React's first effects run — a key pressed then is lost because the keyboard listener isn't
 * attached yet. The core is created in that same effect flush, so once it exists, keys work.
 * The first-run walkthrough is marked done (it would open when the camera starts) unless a test
 * wants it.
 */
/** The fake camera can take several seconds to start while other tests keep the CPU busy. */
const CAMERA_MS = 15_000;

async function openApp(page: Page, { walkthrough = false } = {}): Promise<void> {
  if (!walkthrough) {
    await page.addInitScript(() => localStorage.setItem('gesturespace.onboarded', '1'));
  }
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
  await expect(page.getByText('Camera on')).toBeVisible({ timeout: CAMERA_MS });

  await page.getByRole('button', { name: 'Stop camera' }).click();
  await expect(page.getByRole('heading', { name: 'Camera stopped' })).toBeVisible();
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByText('Camera on')).toBeVisible({ timeout: CAMERA_MS });

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
  // A busy machine (software WebGL + MediaPipe in parallel tests) can take a while to poll.
  await expect(page.getByLabel('Debug panel')).toContainText(/ready · (GPU|CPU)/, {
    timeout: 15_000,
  });
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
  await expect(page.getByText('Camera on')).toBeVisible({ timeout: CAMERA_MS });
  await page.getByRole('button', { name: 'Take a camera snapshot' }).click();
  await pressed('Take another snapshot');
  await page.getByRole('button', { name: 'Live camera' }).click();
  await pressed('Live camera');
  await page.getByRole('button', { name: 'Animated' }).click();
  await pressed('Animated');

  // A 1×1 PNG from "the user's computer".
  await page.getByLabel('Open your own picture').setInputFiles({
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
  await expect(page.getByText('Camera on')).toBeVisible({ timeout: CAMERA_MS });
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
  await expect(page.getByText('Camera on')).toBeVisible({ timeout: CAMERA_MS });
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

test('help: H or ? opens this experience’s gestures and the keys; Esc closes; keys wait', async ({
  page,
}) => {
  await openApp(page);
  await page.keyboard.press('h');
  const help = page.getByRole('dialog', { name: 'Help — Voxel Builder' });
  await expect(help).toBeVisible();
  await expect(help.getByText('Depth Lock (L)')).toBeVisible();
  await expect(help.getByRole('cell', { name: 'Switch experience' })).toBeVisible();
  await page.keyboard.press('3'); // a window is open: experience keys wait
  await expect(page.getByRole('button', { name: /Voxel/ }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await page.keyboard.press('3');
  await page.keyboard.press('Shift+Slash'); // ?
  await expect(page.getByRole('dialog', { name: 'Help — Air Draw' })).toBeVisible();
});

test('settings: changes apply at once and are remembered after a reload', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  const group = (name: string) => dialog.getByRole('group', { name });
  await group('Main hand (builds, draws, picks)').getByRole('button', { name: 'Left' }).click();
  await group('Quality').getByRole('button', { name: 'Low' }).click();
  await dialog.getByRole('switch', { name: 'Reduce motion' }).click();
  await expect(dialog.getByRole('switch', { name: 'Reduce motion' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.reload();
  await page.waitForFunction(() => window.__gs_debug?.coreCreated === 1);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(
    group('Main hand (builds, draws, picks)').getByRole('button', { name: 'Left' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(group('Quality').getByRole('button', { name: 'Low' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dialog.getByRole('button', { name: 'Reset all settings' }).click();
  await expect(
    group('Main hand (builds, draws, picks)').getByRole('button', { name: 'Right' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('walkthrough: opens the first time the camera starts; skipped, it stays away', async ({
  page,
}) => {
  await openApp(page, { walkthrough: true });
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByText('Camera on')).toBeVisible({ timeout: CAMERA_MS });
  const card = page.getByRole('dialog', { name: 'Show your right hand' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Step 2 of 5')).toBeVisible();
  await card.getByRole('button', { name: 'Skip this step' }).click();
  await expect(page.getByRole('dialog', { name: 'Pinch' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip the walkthrough' }).click();
  await expect(page.getByRole('dialog', { name: 'Pinch' })).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => window.__gs_debug?.coreCreated === 1);
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByText('Camera on')).toBeVisible({ timeout: CAMERA_MS });
  await expect(page.getByRole('dialog', { name: 'Show your right hand' })).toBeHidden();
  // Help brings it back.
  await page.keyboard.press('h');
  await page.getByRole('button', { name: 'Show the walkthrough again' }).click();
  await expect(page.getByRole('dialog', { name: 'Show your right hand' })).toBeVisible();
});

test('your work: autosaved across a reload; exported and imported as a file', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await openWithCamera(page);
  const count = page.locator('.gs-toolpanel__count');
  await page.keyboard.press('7');
  for (const name of ['Cube', 'Sphere', 'Donut']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await expect(count).toHaveText('3 objects · 1 selected');
  await page.waitForTimeout(1500); // the autosave comes 1 s after the last change
  await page.reload();
  await page.waitForFunction(() => window.__gs_debug?.coreCreated === 1);
  await page.getByRole('button', { name: 'Enable camera' }).click();
  await expect(page.getByText('Camera on')).toBeVisible({ timeout: CAMERA_MS });
  await page.keyboard.press('7');
  await expect(count).toHaveText('3 objects · 0 selected');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export…' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^gesturespace-objectLab-\d{12}\.json$/);
  const path = await file.path();
  const text = readFileSync(path, 'utf8');
  expect(JSON.parse(text)).toMatchObject({ app: 'GestureSpace', kind: 'scene', mode: 'objectLab' });

  await page.keyboard.press('c');
  await expect(count).toHaveText('0 objects · 0 selected');
  await page.keyboard.press('1'); // import switches back to the Object Lab by itself
  await page.getByLabel('Import a scene file').setInputFiles(path);
  await expect(page.getByText(/Imported .*Ctrl\+Z undoes it/)).toBeVisible();
  await expect(page.getByRole('button', { name: /3D Object Lab/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(count).toHaveText('3 objects · 0 selected');
  await page.keyboard.press('Control+z');
  await expect(count).toHaveText('0 objects · 0 selected');
  expect(errors).toEqual([]);
});
