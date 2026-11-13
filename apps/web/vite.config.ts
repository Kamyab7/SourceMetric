import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { valid } from 'semver';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
function git(...args: string[]) {
  try {
    return execFileSync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}
const tag = git('describe', '--tags', '--exact-match', '--match', 'v[0-9]*');
const commit = git('rev-parse', '--short=7', 'HEAD');
const dirty = Boolean(git('status', '--porcelain', '--untracked-files=no'));
const version =
  tag && valid(tag) && !dirty
    ? tag
    : commit
      ? `dev-${commit}${dirty ? '-dirty' : ''}`
      : 'development';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [vue(), tailwindcss()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
  build: { chunkSizeWarningLimit: 800 },
});
