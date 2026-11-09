import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc', environment: 'local' },
      miniflare: {
        bindings: { TEST_MIGRATIONS: await readD1Migrations('apps/worker/migrations') },
      },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'], fileParallelism: false },
});
