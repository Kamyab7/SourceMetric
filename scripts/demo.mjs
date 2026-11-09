import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDemoFixture } from './demo-fixture.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const port = process.env.DEMO_PORT ?? '8790';
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
  throw new Error('DEMO_PORT must be between 1024 and 65535.');
let child;
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
async function run(args, { quiet = false } = {}) {
  if (stopping) return;
  await new Promise((resolve, reject) => {
    child = spawn('pnpm', args, {
      stdio: quiet ? ['inherit', 'pipe', 'inherit'] : 'inherit',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    if (quiet) child.stdout.resume();
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      child = undefined;
      if (code === 0 || stopping) resolve();
      else
        reject(new Error('Command failed: pnpm ' + args.join(' ') + ' (' + (signal ?? code) + ')'));
    });
  });
}
try {
  await run(['build:web']);
  const shared = [
    '--config',
    'wrangler.demo.jsonc',
    '--local',
    '--persist-to',
    '.wrangler/demo-state',
  ];
  await run(['exec', 'wrangler', 'd1', 'migrations', 'apply', 'sourcemetric-demo', ...shared]);
  if (!stopping) {
    const fixture = createDemoFixture();
    await mkdir('.wrangler', { recursive: true });
    await writeFile('.wrangler/demo-seed.sql', fixture.sql);
    console.log('Seeding synthetic package history…');
    await run(
      [
        'exec',
        'wrangler',
        'd1',
        'execute',
        'sourcemetric-demo',
        ...shared,
        '--file',
        '.wrangler/demo-seed.sql',
      ],
      { quiet: true },
    );
    console.log('\nSourceMetric demo — synthetic data, read-only, no registry calls.');
    console.log(JSON.stringify(fixture.counts));
    console.log('Open http://localhost:' + port + '\n');
    await run([
      'exec',
      'wrangler',
      'dev',
      '--config',
      'wrangler.demo.jsonc',
      '--local',
      '--persist-to',
      '.wrangler/demo-state',
      '--ip',
      '127.0.0.1',
      '--port',
      port,
    ]);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
