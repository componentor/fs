import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/benchmark',
  fullyParallel: false, // Run tests sequentially to avoid conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for benchmark consistency
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // PORT override lets the suite run when another dev server squats :3000
    baseURL: `http://localhost:${process.env.PORT || 3000}`,
    trace: 'on-first-retry',
    // Larger viewport for benchmark UI
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Enable features needed for OPFS
        launchOptions: {
          args: [
            '--enable-features=FileSystemAccessAPI',
          ],
        },
      },
    },
    // Cross-browser correctness projects. Benchmarks stay chromium-only for
    // comparability; correctness specs run everywhere via:
    //   npx playwright test sab-chunking cross-browser --project=chromium --project=firefox --project=webkit
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: /benchmark\.spec\.ts/,
    },
    {
      name: 'webkit', // Safari's engine
      use: { ...devices['Desktop Safari'] },
      testIgnore: /benchmark\.spec\.ts/,
    },
    // Edge is Chromium-based; the chromium project covers its engine. This
    // project runs against the real Edge channel when it is installed:
    //   npx playwright test --project=msedge   (requires Microsoft Edge)
    {
      name: 'msedge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
      testIgnore: /benchmark\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'node tests/benchmark/server.js',
    url: `http://localhost:${process.env.PORT || 3000}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
