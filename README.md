# SourceMetric

A private, self-hosted growth dashboard for open-source maintainers. Track listed NuGet packages, retain download observations, and add release or campaign notes.

## Included

- Vue 3 dashboard with a dark Tailwind CSS/daisyUI theme, self-hosted Inter, Lucide icons, and workspace, project, and package views, date filters, version channels, ECharts trends, and CSV exports.
- Projects with shared packages, archive/restore, and explicit permanent history deletion.
- NuGet service discovery, exact package resolution, package/version counters, and version discovery notes.
- Hourly Worker scheduling, six-hour per-package cadence, bounded collection, expiring D1 leases, retries, and collection status.
- D1 SQL migrations and Drizzle, shared Zod contracts, Access JWT verification, and mutation-origin checks.
- Provider factory and measurement contracts for additional registry adapters. Only NuGet is implemented.

One deployment is one shared workspace. Everyone admitted by Access has the same permissions.

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
    pnpm exec playwright install chromium
    pnpm test:e2e
    pnpm format:check

Tests use the current Cloudflare Vitest plugin and local Workers runtime. Integration tests isolate D1 storage; Playwright uses a separate local state directory. Tests never deploy. Build includes a production Worker packaging dry run.

## Deployment and architecture

- [Deployment, Access, backups, and operations](docs/deployment.md)
- [Feature architecture, API, and provider extension](docs/architecture.md)
- [Measurement semantics and capacity](docs/metrics-and-capacity.md)

Configure your own D1 database, custom domain, and Access application before deployment. Production intentionally refuses requests until Access settings are supplied.

Free-tier operation is a target, **not verified on a deployed account**. Indefinite version history consumes storage; single-database limits matter.

## License

[MIT](LICENSE)
