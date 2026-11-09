import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  use: { baseURL: 'http://localhost:8787', browserName: 'chromium', screenshot: 'only-on-failure' },
  webServer: {
    command:
      'pnpm build:web && pnpm exec wrangler d1 migrations apply sourcemetric --local --env local --persist-to .wrangler/e2e-state && pnpm exec wrangler dev --env local --port 8787 --test-scheduled --persist-to .wrangler/e2e-state',
    url: 'http://localhost:8787/api/v1/health',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
