import { beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { applyD1Migrations, reset } from 'cloudflare:test';
beforeEach(async () => {
  await reset();
  const bindings = env as unknown as Env & {
    TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  };
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
});
