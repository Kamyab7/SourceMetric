# SourceMetric

SourceMetric collects marketing and growth data for open-source maintainers. Track NuGet downloads and GitHub stars, forks, clones, and views in one private dashboard. Add release and campaign notes to see how your outreach relates to changes in your projects.

Host it on your own Cloudflare account with a single setup script. It is designed for Cloudflare’s free tier, within its [usage limits](https://developers.cloudflare.com/workers/platform/limits/) and [database allowance](https://developers.cloudflare.com/d1/platform/pricing/).

## Features

| Feature              | What it does                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| NuGet tracking       | Track package downloads and version-level metrics over time.                                                 |
| GitHub tracking      | Track repository stars, forks, clones, and views.                                                            |
| Traffic insights     | Explore repository visitors, popular content, and referring sites.                                           |
| Project organization | Group related packages and repositories into projects.                                                       |
| Growth dashboard     | View historical metrics and trends in one dashboard.                                                         |
| Releases & campaigns | Add dated notes to give changes in your metrics context.                                                     |
| Automatic collection | Collect data on a schedule and monitor collection status.                                                    |
| AI connections       | Give AI clients read-only access to tracked stats through OAuth-enabled MCP connections that you can revoke. |
| Private self-hosting | Run on your own Cloudflare account with email sign-in through Cloudflare Access.                             |
| Local demo           | Explore sample projects and metrics without an account or API tokens.                                        |

## Quick start

You need Node.js 22.12+, pnpm 11, and a Cloudflare account with Zero Trust onboarding completed.

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/Kamyab7/SourceMetric.git
   cd SourceMetric
   pnpm install --frozen-lockfile
   cp .env.example .env
   ```

2. Fill in `.env` with your account details:

   ```dotenv
   CLOUDFLARE_ACCOUNT_ID=your-account-id
   CLOUDFLARE_API_TOKEN=your-api-token
   ACCESS_ALLOWED_EMAILS=you@example.com
   ```

   | Variable                | What to enter                                                      |
   | ----------------------- | ------------------------------------------------------------------ |
   | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID, available in the Cloudflare dashboard. |
   | `CLOUDFLARE_API_TOKEN`  | An account-scoped API token with the permissions listed below.     |
   | `ACCESS_ALLOWED_EMAILS` | Email addresses allowed to sign in, separated by commas.           |

   Give the Cloudflare API token these account permissions: **Workers Scripts: Edit**, **Workers Tail: Read**, **D1: Edit**, **Access: Apps and Policies: Edit**, and **Access: Organizations, Identity Providers, and Groups: Edit**.

   Optional settings:

   | Variable            | When to use it                                                                                                                                                                                                  |
   | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `GITHUB_TOKEN`      | Enable GitHub repository collection. Use a fine-grained token with **Metadata: read** and **Administration: read** for the repositories you want to track. Your account must have access to their traffic data. |
   | `WORKERS_SUBDOMAIN` | Choose a unique subdomain if your Cloudflare account does not already have a `workers.dev` subdomain.                                                                                                           |
   | `WORKER_NAME`       | Change the deployment name; defaults to `sourcemetric`.                                                                                                                                                         |
   | `CUSTOM_DOMAIN`     | Use your own hostname, such as `metrics.example.com`, instead of `workers.dev`. See [custom domain setup](docs/deployment.md#automated-wrangler-setup) for the extra permissions.                               |

   NuGet tracking needs no token. Keep `.env` private; it is ignored by Git.

3. Run the setup script:

   ```bash
   pnpm deploy
   ```

   The script builds and deploys SourceMetric, creates its database, schedules collection, and sets up email sign-in. No custom domain is required. Open the URL it prints and sign in with an allowed email address using a one-time PIN.

4. Add your packages and repositories, then group them into projects. Data collection runs automatically; history builds as new observations arrive.

Run `pnpm deploy` again to deploy updates. For more setup help, see the [deployment guide](docs/deployment.md).

## Useful commands

| Command                    | Purpose                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm demo`                | Explore sample projects, metrics, and campaign notes at [localhost:8790](http://localhost:8790). |
| `DEMO_PORT=8791 pnpm demo` | Run the demo on a different port.                                                                |
| `pnpm db:local`            | Apply database migrations before running locally.                                                |
| `pnpm dev`                 | Run the app locally at [localhost:8787](http://localhost:8787).                                  |
| `pnpm dev:web`             | Run frontend hot reload at [localhost:5173](http://localhost:5173) in another terminal.          |
| `pnpm deploy`              | Set up or update your Cloudflare deployment.                                                     |
| `pnpm build`               | Build the frontend.                                                                              |
| `pnpm typecheck`           | Check TypeScript types.                                                                          |
| `pnpm test`                | Run unit and integration tests.                                                                  |
| `pnpm check:deploy`        | Check deployment packaging without deploying.                                                    |
| `pnpm test:e2e`            | Run browser tests.                                                                               |
| `pnpm test:demo`           | Run demo browser tests.                                                                          |
| `pnpm format:check`        | Check formatting.                                                                                |
| `pnpm format`              | Format the project.                                                                              |

The demo needs no Cloudflare account or API tokens. It is read-only and resets its sample data on each launch. Stop it with Ctrl+C.

Before running browser tests, install Chromium with `pnpm exec playwright install chromium`.

## License

SourceMetric is licensed under the [MIT License](LICENSE).
