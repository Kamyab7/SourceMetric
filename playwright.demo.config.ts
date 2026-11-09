import { defineConfig } from '@playwright/test';
export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 1 : undefined,
  globalTimeout: 5 * 60 * 1000,
  outputDir: 'test-results/demo',

  testDir: 'tests/demo-e2e',
  use: {
    baseURL: 'http://localhost:8791',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm run demo',
    env: { DEMO_PORT: '8791' },
    url: 'http://localhost:8791/api/v1/health',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
