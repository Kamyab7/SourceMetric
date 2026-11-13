import { defineConfig } from '@playwright/test';
export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 1 : undefined,
  globalTimeout: 5 * 60 * 1000,
  outputDir: 'test-results/e2e',

  testDir: 'tests/e2e',
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:8789',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    env: { CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' },
    command:
      'pnpm build:web && pnpm exec wrangler d1 migrations apply sourcemetric --local --env local --persist-to .wrangler/e2e-state && pnpm exec wrangler dev --env local --port 8789 --test-scheduled --persist-to .wrangler/e2e-state',
    url: 'http://localhost:8789/api/v1/health',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
