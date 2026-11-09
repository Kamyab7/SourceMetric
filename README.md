# SourceMetric

> [!WARNING]
> SourceMetric is under active development and is not yet production-ready. Features, APIs, and the database schema may change without backward compatibility. Use it for evaluation and testing, and back up your data before upgrading.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FKamyab7%2FSourceMetric)

A private, self-hosted growth dashboard for open-source maintainers. Track listed NuGet packages, retain download observations, and add release or campaign notes.

## Deploy to Cloudflare

Use the button above to copy this repository into your GitHub/GitLab account and provision the Worker and D1 database. The Worker includes the Vue assets and hourly collection schedule; the deploy command applies database migrations using the DB binding.

In the deployment form, keep the repository root as the project directory, use **pnpm run build** for the build command and **pnpm run deploy** for the deploy command. Cloudflare installs dependencies using the committed pnpm lockfile.

**Finish the [custom domain and Cloudflare Access setup](docs/deployment.md#deploy-button)** before using the dashboard. The button does not create Access applications, access policies, or DNS/custom domains. Until authentication is configured, the Worker rejects requests; workers.dev and preview URLs remain disabled.

## Included

- Vue 3 dashboard with a dark Tailwind CSS/daisyUI theme, self-hosted Inter, Lucide icons, and workspace, project, and package views, date filters, version channels, ECharts trends, and CSV exports.
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

The demo includes three projects, six synthetic packages, seven months of six-hour observations, version adoption, release/campaign annotations, and collection activity. All screens and CSV exports use the real Worker API and local D1 queries. Demo mode is read-only and never fetches registry data.

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

D1 is automatically provisioned by the deploy button, or can be created manually. Configure your custom domain and Access application to enable the deployed dashboard. Production intentionally refuses requests until Access settings are supplied.

Free-tier operation is a target, **not verified on a deployed account**. Indefinite version history consumes storage; single-database limits matter.

## License

[MIT](LICENSE)
