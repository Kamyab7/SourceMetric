import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, type ParseError } from 'jsonc-parser';

type Resource = { id: string; name?: string; domain?: string; aud?: string; type?: string };
type Envelope<T> = {
  success: boolean;
  result: T;
  errors?: { code: number }[];
  result_info?: { total_pages?: number };
};

export function settings(env: NodeJS.ProcessEnv) {
  const required = (key: string) => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Set ${key} before running setup.`);
    return value;
  };
  const accountId = required('CLOUDFLARE_ACCOUNT_ID');
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Invalid CLOUDFLARE_ACCOUNT_ID.');
  const token = required('CLOUDFLARE_API_TOKEN');
  const emails = [
    ...new Set(
      required('ACCESS_ALLOWED_EMAILS')
        .split(',')
        .map((v) => v.trim().toLowerCase()),
    ),
  ];
  if (emails.some((v) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)))
    throw new Error('ACCESS_ALLOWED_EMAILS must contain comma-separated email addresses.');
  const name = env.WORKER_NAME?.trim() || 'sourcemetric';
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new Error('Invalid WORKER_NAME.');
  const subdomain = env.WORKERS_SUBDOMAIN?.trim();
  if (subdomain && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(subdomain))
    throw new Error('Invalid WORKERS_SUBDOMAIN.');
  const customDomain = env.CUSTOM_DOMAIN?.trim().toLowerCase() || undefined;
  if (
    customDomain &&
    (customDomain.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
        customDomain,
      ) ||
      customDomain.endsWith('.workers.dev'))
  )
    throw new Error(
      'CUSTOM_DOMAIN must be a hostname such as metrics.example.com, without a scheme, path, port, or wildcard.',
    );
  return { accountId, token, emails, name, subdomain, customDomain };
}

export async function setup(
  env = process.env,
  fetcher = fetch,
  run = runCommand,
  outputDirectory = '.wrangler/deploy',
) {
  const options = settings(env);
  const root = resolve(import.meta.dirname, '..');
  const errors: ParseError[] = [];
  const base = parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'), errors, {
    allowTrailingComma: true,
  });
  if (errors.length) throw new Error('Invalid wrangler.jsonc.');
  const account = `/accounts/${options.accountId}`;
  async function api<T>(path: string, method = 'GET', body?: unknown, missing = false): Promise<T> {
    const response = await fetcher(`https://api.cloudflare.com/client/v4${account}${path}`, {
      method,
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (missing && response.status === 404) return undefined as T;
    const data = (await response.json()) as Envelope<T>;
    if (!response.ok || !data.success) {
      // Do not print response bodies: they may echo secrets or personal information.
      throw new Error(
        `Cloudflare ${method} ${path} failed (HTTP ${response.status}; codes ${data.errors?.map((e) => e.code).join(',') || 'unknown'}). Check token permissions and account setup.`,
      );
    }
    return data.result;
  }
  async function list<T>(path: string): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; ; page++) {
      const items = await api<T[]>(`${path}?page=${page}&per_page=50`);
      result.push(...items);
      if (items.length < 50) return result;
    }
  }
  // Compile before creating remote resources; subsequent failures are safe to rerun.
  run(['run', 'build:web'], root);
  let hostname = options.customDomain;
  if (!hostname) {
    let sub = await api<{ subdomain: string } | undefined>(
      '/workers/subdomain',
      'GET',
      undefined,
      true,
    );
    if (!sub?.subdomain) {
      if (!options.subdomain)
        throw new Error('Set WORKERS_SUBDOMAIN to register your account workers.dev subdomain.');
      sub = await api('/workers/subdomain', 'PUT', { subdomain: options.subdomain });
    } else if (options.subdomain && sub.subdomain !== options.subdomain) {
      throw new Error(
        'WORKERS_SUBDOMAIN differs from the existing account subdomain; refusing to rename it.',
      );
    }
    hostname = `${options.name}.${sub!.subdomain}.workers.dev`;
  }
  let organization = await api<{ auth_domain: string } | undefined>(
    '/access/organizations',
    'GET',
    undefined,
    true,
  );
  if (!organization)
    organization = await api('/access/organizations', 'POST', { name: 'SourceMetric' });
  if (!organization?.auth_domain)
    throw new Error(
      'Zero Trust organization has no auth_domain. Complete account onboarding, then rerun.',
    );
  const providers = await list<Resource>('/access/identity_providers');
  const provider =
    providers.find((p) => p.type === 'onetimepin') ||
    (await api<Resource>('/access/identity_providers', 'POST', {
      name: 'Email one-time PIN',
      type: 'onetimepin',
      config: {},
    }));
  const appName = `SourceMetric setup: ${options.name}`;
  const apps = await list<Resource>('/access/apps');
  const existing = apps.find((a) => a.domain === hostname);
  if (existing && existing.name !== appName)
    throw new Error(
      'An unmanaged Access application already protects this hostname. Refusing to overwrite it.',
    );
  const appBody = {
    name: appName,
    domain: hostname,
    type: 'self_hosted',
    session_duration: '24h',
    allowed_idps: [provider.id],
    auto_redirect_to_identity: true,
  };
  const policies = existing ? await list<Resource>(`/access/apps/${existing.id}/policies`) : [];
  const policyName = 'SourceMetric email allowlist';
  if (policies.some((p) => p.name !== policyName) || policies.length > 1)
    throw new Error('Unexpected Access policies found; refusing to modify this application.');
  const app = await api<Resource>(
    existing ? `/access/apps/${existing.id}` : '/access/apps',
    existing ? 'PUT' : 'POST',
    appBody,
  );
  if (!app.aud) throw new Error('Access application returned no audience.');
  const policy = policies[0];
  await api(
    `/access/apps/${app.id}/policies${policy ? `/${policy.id}` : ''}`,
    policy ? 'PUT' : 'POST',
    {
      name: policyName,
      decision: 'allow',
      precedence: 1,
      include: options.emails.map((email) => ({ email: { email } })),
      require: [],
      exclude: [],
    },
  );
  // Narrower Access applications let OAuth/MCP clients reach protocol endpoints.
  // The Worker validates OAuth; the parent application's email policy stays intact.
  const publicPaths = [
    '/mcp',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/oauth/token',
    '/oauth/register',
  ];
  for (const path of publicPaths) {
    const domain = hostname + path;
    const name = `SourceMetric MCP setup: ${options.name}${path}`;
    const previous = apps.find((a) => a.domain === domain);
    if (previous && previous.name !== name)
      throw new Error(
        'An unmanaged Access application protects an MCP endpoint. Refusing to overwrite it.',
      );
    const existingPolicies = previous
      ? await list<Resource>(`/access/apps/${previous.id}/policies`)
      : [];
    if (
      existingPolicies.length > 1 ||
      existingPolicies.some((p) => p.name !== 'SourceMetric OAuth protocol bypass')
    )
      throw new Error('Unexpected MCP Access policies; refusing to modify this application.');
    const bypassApp = await api<Resource>(
      previous ? `/access/apps/${previous.id}` : '/access/apps',
      previous ? 'PUT' : 'POST',
      { name, domain, type: 'self_hosted', session_duration: '24h' },
    );
    const policy = existingPolicies[0];
    await api(
      `/access/apps/${bypassApp.id}/policies${policy ? `/${policy.id}` : ''}`,
      policy ? 'PUT' : 'POST',
      {
        name: 'SourceMetric OAuth protocol bypass',
        decision: 'bypass',
        precedence: 1,
        include: [{ everyone: {} }],
        require: [],
        exclude: [],
      },
    );
  }
  const namespaces = await list<{ id: string; title: string }>('/storage/kv/namespaces');
  const oauthTitle = `${options.name}-oauth`;
  const oauthNamespace =
    namespaces.find((n) => n.title === oauthTitle) ??
    (await api<{ id: string }>('/storage/kv/namespaces', 'POST', { title: oauthTitle }));
  const databases = await list<{ uuid: string; name: string }>('/d1/database');
  const database =
    databases.find((d) => d.name === options.name) ||
    (await api<{ uuid: string }>('/d1/database', 'POST', { name: options.name }));
  const { env: _env, routes: _routes, route: _route, ...production } = base;
  const config = {
    ...production,
    account_id: options.accountId,
    name: options.name,
    workers_dev: !options.customDomain,
    routes: options.customDomain ? [{ pattern: options.customDomain, custom_domain: true }] : [],
    preview_urls: false,
    main: resolve(root, base.main),
    assets: { ...base.assets, directory: resolve(root, base.assets.directory) },
    kv_namespaces: [{ binding: 'OAUTH_KV', id: oauthNamespace.id }],
    d1_databases: [
      {
        binding: 'DB',
        database_name: options.name,
        database_id: database.uuid,
        migrations_dir: resolve(root, 'apps/worker/migrations'),
      },
    ],
    vars: {
      ...base.vars,
      APP_ENV: 'production',
      DEMO_MODE: 'false',
      ACCESS_TEAM_DOMAIN: organization.auth_domain,
      ACCESS_AUD: app.aud,
      APP_ORIGIN: `https://${hostname}`,
    },
  };
  const configPath = resolve(root, outputDirectory, 'wrangler.json');
  await mkdir(resolve(root, outputDirectory), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  const flags = ['--config', configPath, '--env='];
  run(['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote', ...flags], root);
  run(['exec', 'wrangler', 'deploy', ...flags], root);
  if (env.GITHUB_TOKEN)
    run(
      ['exec', 'wrangler', 'secret', 'put', 'GITHUB_TOKEN', ...flags],
      root,
      env.GITHUB_TOKEN + '\n',
    );
  console.log(
    `SourceMetric deployed: https://${hostname}\nSign in using an allowed email address. Deployment config: ${configPath}`,
  );
}

function runCommand(args: string[], cwd: string, input?: string) {
  const child = spawnSync('pnpm', args, {
    cwd,
    input,
    stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, CI: 'true' },
  });
  if (child.error || child.status !== 0) throw new Error(`Command failed: pnpm ${args.join(' ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  async function main() {
    try {
      loadEnvFile(resolve(import.meta.dirname, '../.env'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await setup();
  }
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
