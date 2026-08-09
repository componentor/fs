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
            // Playwright's chrome-headless-shell ships with PartitionAlloc's dangling-`raw_ptr`
            // detector on. Under the heaviest specs (the LightningFS comparison, create-scaling)
            // it fires `FATAL: Detected dangling raw_ptr in unretained` while tearing down a page
            // that used OPFS + FileSystemObserver, which aborts the whole browser process — so
            // the *next* test fails with "Target page, context or browser has been closed", and
            // which test that is moves around between runs.
            //
            // A dangling `raw_ptr` is a use-after-free in Chromium's own C++; JavaScript has no
            // way to create one, so this is a browser bug our load happens to trigger, not a leak
            // in this library. (Verified: a page that leaves a recursive FileSystemObserver
            // attached and closes does *not* trip it — so it is not simply "we forgot to
            // disconnect", and the teardown added in 3.3.29 does not make it go away either.)
            // Release Chrome ships with this detector off, so no user sees it.
            '--disable-features=PartitionAllocDanglingPtr',
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
