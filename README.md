# SourceMetric

SourceMetric collects marketing and growth data for open-source maintainers. Track NuGet downloads and GitHub stars, forks, clones, and views in one private dashboard. Add release and campaign notes to see how your outreach relates to changes in your projects.

Host it on your own Cloudflare account with a single setup script. It is designed for Cloudflare’s free tier, within its [usage limits](https://developers.cloudflare.com/workers/platform/limits/) and [database allowance](https://developers.cloudflare.com/d1/platform/pricing/).

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

### Try the demo

```bash
pnpm demo
```

Open [localhost:8790](http://localhost:8790) to explore sample projects, metrics, and campaign notes. No Cloudflare account or API tokens are needed. The demo is read-only and resets its sample data on each launch. Stop it with Ctrl+C.

To use another port:

```bash
DEMO_PORT=8791 pnpm demo
```

### Run locally

```bash
pnpm db:local
pnpm dev
```

Open [localhost:8787](http://localhost:8787). For frontend hot reload, run `pnpm dev:web` in another terminal and open [localhost:5173](http://localhost:5173).

### Build and check

| Command             | Purpose                                       |
| ------------------- | --------------------------------------------- |
| `pnpm deploy`       | Set up or update your Cloudflare deployment.  |
| `pnpm build`        | Build the frontend.                           |
| `pnpm typecheck`    | Check TypeScript types.                       |
| `pnpm test`         | Run unit and integration tests.               |
| `pnpm check:deploy` | Check deployment packaging without deploying. |
| `pnpm test:e2e`     | Run browser tests.                            |
| `pnpm test:demo`    | Run demo browser tests.                       |
| `pnpm format:check` | Check formatting.                             |
| `pnpm format`       | Format the project.                           |

Before running browser tests, install Chromium with `pnpm exec playwright install chromium`.

## License

SourceMetric is licensed under the [MIT License](LICENSE).

### AI connections (read-only MCP)

Open **AI connections** to copy your `/mcp` URL and add it as an OAuth-enabled
remote MCP server in your AI client. Sign in through Cloudflare Access and approve
read-only access to all tracked stats, including private GitHub repository names
and traffic. You can view and revoke your connections on the same page. The MCP
server exposes nine read tools and cannot edit data or queue collection.

Existing deployments need a dedicated OAuth KV namespace, the connection-registry
migration, and path-specific Access bypass applications for protocol discovery,
registration, tokens and `/mcp`. See the [OAuth MCP deployment guide](docs/deployment.md#read-only-oauth-mcp-connections).
