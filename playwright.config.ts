import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/benchmark',
  fullyParallel: false, // Run tests sequentially to avoid conflicts
  forbidOnly: !!process.env.CI,
  /**
   * One local retry: Chromium can still abort the browser process mid-suite.
   *
   * `FATAL: Detected dangling raw_ptr` is a use-after-free in Chromium's own C++, triggered by a
   * recursive `FileSystemObserver` that is still attached when its scope is destroyed. Proven by
   * construction — disabling the observer removes the crash from a full run entirely, restoring
   * it brings it back within a few specs — and it reproduces on both `chrome-headless-shell` and
   * the full Chrome for Testing binary. `--disable-features=PartitionAllocDanglingPtr` does not
   * switch the detector off.
   *
   * 4.0.0 moved detection into the scope that owns the instance, where `disconnect()` is
   * synchronous on the unload path, and the fixture releases every filesystem on every page
   * before teardown. That covers page-hosted instances. It does **not** cover a *worker-hosted*
   * instance: its observer lives in a worker the page cannot reach synchronously, and the worker
   * is killed outright when the page goes. Until that case has an answer, the retry stays.
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
        // The full Chromium binary in new headless mode, not `chrome-headless-shell`.
        // See the `retries` note above: the shell ships with PartitionAlloc's dangling-`raw_ptr`
        // detector compiled in and aborts the whole browser process after the heaviest OPFS
        // specs. This binary is what real users run.
        channel: 'chromium',
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
