import { defineConfig, devices } from '@playwright/test';

// Chromium with a fake camera so E2E runs without real hardware (§25).
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  // Each test runs a browser drawing WebGL in software plus MediaPipe on the fake camera: more
  // than ~6 at once starve each other of CPU (16 tests on 10 workers timed out, Phase 12).
  workers: 6,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        permissions: ['camera'],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
  ],
  webServer: {
    // --mode test keeps window.__gs_debug counters (FEATURE_FLAGS.debugCounters) for leak checks.
    command: 'npx vite build --mode test && npx vite preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
