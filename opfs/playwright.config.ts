import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/benchmark',
  fullyParallel: false, // Run tests sequentially to avoid conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for benchmark consistency
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
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
  ],
  webServer: {
    command: 'node tests/benchmark/server.js',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
