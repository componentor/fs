import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/benchmark',
  fullyParallel: false, // Run tests sequentially to avoid conflicts
  forbidOnly: !!process.env.CI,
  /**
   * One retry locally, because Chromium can take itself down mid-suite.
   *
   * Playwright's `chrome-headless-shell` ships with PartitionAlloc's dangling-`raw_ptr` detector
   * enabled. After the heaviest specs it fires `FATAL: Detected dangling raw_ptr in unretained`
   * while tearing down a page that used OPFS, which aborts the **browser process** — so the next
   * test in line dies with "Target page, context or browser has been closed", and which test
   * that is moves around between runs.
   *
   * That is a use-after-free in Chromium's own C++. JavaScript cannot create one, so it is a
   * browser bug this workload happens to trigger, not a defect here — confirmed two ways: a page
   * that deliberately leaks a recursive `FileSystemObserver` and closes does *not* trip it, and
   * fixing the library's genuine observer/worker leak (3.3.29) did not stop it either. Release
   * Chrome ships the detector off, so no user meets it. `--disable-features=PartitionAllocDanglingPtr`
   * does not turn it off in this binary.
   *
   * A retry gets a freshly launched browser and passes, which is the honest handling: re-run the
   * test the crash stole, rather than pretend the crash did not happen.
   */
  retries: process.env.CI ? 2 : 1,
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
