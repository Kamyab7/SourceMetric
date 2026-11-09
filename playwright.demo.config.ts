import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/demo-e2e',
  use: { baseURL: 'http://localhost:8791', browserName: 'chromium', screenshot: 'only-on-failure' },
  webServer: {
    command: 'pnpm run demo',
    env: { DEMO_PORT: '8791' },
    url: 'http://localhost:8791/api/v1/health',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
