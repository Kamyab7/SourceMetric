# SourceMetric

> [!WARNING]
> SourceMetric is under active development and is not yet production-ready. Features, APIs, and the database schema may change without backward compatibility. Use it for evaluation and testing, and back up your data before upgrading.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FKamyab7%2FSourceMetric)

A private, self-hosted growth dashboard for open-source maintainers. Track listed NuGet packages and GitHub repositories, retain download/clone history and star/fork snapshots, and add release or campaign notes.

## Deploy to Cloudflare

Use Wrangler and the TypeScript setup script to create and configure D1, Cloudflare Access, email one-time PIN login, and a protected `workers.dev` URL. No custom domain is required. Optionally set `CUSTOM_DOMAIN=metrics.example.com` in `.env` to use a domain in your Cloudflare account instead; see the deployment guide for additional token permissions.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# Edit .env with your account ID, API token, and allowed email addresses.
pnpm deploy
```

The script builds the frontend, provisions services, applies migrations, and deploys the Worker, assets, hourly schedule, and observability configuration. Rerun the same command for updates. The setup script loads the root `.env` file automatically; existing shell or CI variables take precedence. `.env` is ignored by Git. See [deployment setup and permissions](docs/deployment.md#automated-wrangler-setup).

The deploy button remains an alternative for custom-domain deployments; use `pnpm run deploy:manual` as its deploy command and finish the [manual Access setup](docs/deployment.md#deploy-button).

## Included

- Vue 3 dashboard with a dark Tailwind CSS/daisyUI theme, self-hosted Inter, Lucide icons, and workspace, project, and package views, date filters, version channels, ECharts trends, and CSV exports.
- GitHub repository management, project associations, clone/view history, daily unique visitors, star/fork net change, historical popular-content/referrer snapshots, charts, CSV exports, and per-endpoint collection health. Optional deployment-level `GITHUB_TOKEN` secret; see [setup](docs/deployment.md#github-repository-metrics).
- Projects with shared packages, archive/restore, and explicit permanent history deletion.
- NuGet service discovery, exact package resolution, package/version counters, and version discovery notes.
- Hourly Worker scheduling, six-hour per-package cadence, bounded collection, expiring D1 leases, retries, and collection status.
- D1 SQL migrations and Drizzle, shared Zod contracts, Access JWT verification, and mutation-origin checks.
- Provider factory and measurement contracts for additional registry adapters. Only NuGet is implemented.

One deployment is one shared workspace. Everyone admitted by Access has the same permissions.

## Explore the demo

    pnpm install --frozen-lockfile
    pnpm run demo

Open [localhost:8790](http://localhost:8790). No Cloudflare account, Access setup, or NuGet connection is needed.

The demo includes three projects, six synthetic packages, seven months of six-hour observations, version adoption, three GitHub repositories with snapshot/clone histories and partial failures, release/campaign annotations, and collection activity. All screens and CSV exports use the real Worker API and local D1 queries. Demo mode is read-only and never fetches registry or GitHub data.

Every launch rebuilds the app and resets **only** the separate demo database in .wrangler/demo-state, with dates refreshed relative to today. Your development and production databases are unaffected. Stop with Ctrl+C. Set DEMO_PORT to choose a different port, for example DEMO_PORT=8791 pnpm run demo.

## Local development

Requires Node.js 22.12+ and pnpm 11.

    pnpm install --frozen-lockfile
    pnpm db:local
    pnpm dev

Open [localhost:8787](http://localhost:8787). The local Wrangler environment bypasses Access **only on loopback hostnames**. Local development uses local D1 and makes real read-only requests to nuget.org when registering or collecting packages.

For Vue hot reload, run pnpm dev:web in another terminal and open [localhost:5173](http://localhost:5173). Its API proxy uses the local Worker.

Register a package and wait for collection, or trigger the development-only scheduled endpoint:

    curl 'http://localhost:8787/__scheduled?cron=0+*+*+*+*'

The endpoint is supplied by Wrangler's test-scheduled option, not a production API. Manual refresh queues for the next hourly run. Four packages are processed per invocation with concurrency two. This is below the planned maximum of five to leave free-tier query/subrequest headroom; twenty packages fit within a six-hour scheduling cycle.

## Checks

    pnpm types
    pnpm typecheck
    pnpm test
    pnpm build
    pnpm check:deploy
    pnpm exec playwright install chromium
    pnpm test:e2e
    pnpm test:demo
    pnpm format:check

Tests use the current Cloudflare Vitest plugin and local Workers runtime. Integration tests isolate D1 storage; Playwright uses a separate local state directory. Tests never deploy. The check:deploy command validates production Worker packaging with a dry run; build only compiles the Vue app.

Pull requests targeting master run the [CI workflow](.github/workflows/ci.yml): frozen-lockfile installation, formatting, type checks, unit/integration tests, production build and Worker packaging dry run, and both browser suites. Failed browser runs upload screenshots and Playwright traces for seven days. The workflow also supports manual runs and does not deploy or require Cloudflare credentials.

## Deployment and architecture

- [Deployment, Access, backups, and operations](docs/deployment.md)
- [Feature architecture, API, and provider extension](docs/architecture.md)
- [Measurement semantics and capacity](docs/metrics-and-capacity.md)

The automated setup provisions D1 and Access for the workers.dev hostname. Production continues to verify Access JWTs and mutation origins.

Free-tier operation is a target, **not verified on a deployed account**. Indefinite version history consumes storage; single-database limits matter.

## License

[MIT](LICENSE)
