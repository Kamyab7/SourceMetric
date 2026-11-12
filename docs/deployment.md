# Deployment and operations

## Automated Wrangler setup

`pnpm deploy` runs `scripts/setup-cloudflare.ts` using the project-local `tsx` runner (Node 22.12+). Wrangler handles bundling, assets, D1 migrations, secrets, Cron Triggers, and deployment. The script uses the Cloudflare REST API for provisioning and Access configuration.

Required environment variables:

| Variable                | Value                                              |
| ----------------------- | -------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | Target Cloudflare account ID                       |
| `CLOUDFLARE_API_TOKEN`  | API token scoped to that account                   |
| `ACCESS_ALLOWED_EMAILS` | Comma-separated email addresses allowed to sign in |

Optional variables:

| Variable            | Default / behavior                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `WORKER_NAME`       | `sourcemetric`; also used for the D1 database name                                                                         |
| `WORKERS_SUBDOMAIN` | Reuses the account's existing subdomain; required to register one on a fresh account. Never renames an existing subdomain. |
| `GITHUB_TOKEN`      | If supplied, uploads the optional repository-metrics secret through stdin; otherwise leaves any existing secret unchanged  |

Create an account-scoped API token with **Workers Scripts: Edit**, **Workers Tail: Read** (deployment observability), **D1: Edit**, **Access: Apps and Policies: Edit**, and **Access: Organizations, Identity Providers, and Groups: Edit** permissions. No DNS or zone permission is needed. Copy `.env.example` to `.env` in the repository root and fill in the values, or use a protected CI environment. The script loads `.env` automatically without overriding existing shell or CI variables. A missing `.env` is allowed. `.env` is ignored by Git, and the script does not print tokens. You must already have a Cloudflare account and any required account/Zero Trust plan onboarding completed; it does not purchase subscriptions.

Run the commands in the README. The script reuses or registers the account workers.dev subdomain, reuses or creates a Zero Trust organization, and reuses or creates an email one-time PIN identity provider. It creates an Access application for the entire Worker hostname and reconciles its explicit email allowlist on each run. Other applications and organization settings are preserved. It refuses to overwrite an existing application without its setup naming marker or to proceed with unexpected policies. Use the same account and Worker name on subsequent deployments; changing the name provisions another deployment.

The generated `.wrangler/deploy/wrangler.json` includes the actual account, database ID, Access audience, team domain, and exact HTTPS origin. It is ignored by Git and does not contain credentials. The checked-in Wrangler config remains the local-development/manual-deployment template. When `CUSTOM_DOMAIN` is set, Wrangler creates the Custom Domain, DNS record, and certificate; the script protects that hostname with Access, sets its HTTPS origin, and disables workers.dev. The zone must already be active in the same account. Add **Zone: Read** and **Workers Routes: Edit** permissions scoped to that zone ([Cloudflare permissions](https://developers.cloudflare.com/workers/authorization/workers/)). Supply only a hostname, without `https://` or a path. Workers subdomain registration is skipped in this mode. Changing or removing `CUSTOM_DOMAIN` reconciles the Worker routes on the next deploy; previously created Access applications are retained. Preview URLs remain disabled, production mode stays enabled, and all asset requests pass through Worker authentication.

Migrations run before deployment; failures stop the script. Provisioning is incremental, so failures can leave created resources; rerun after correcting the error. The script does not automatically delete databases or undo applied migrations. Do not run setup concurrently against the same Worker. Back up an existing D1 database before schema upgrades.

After deployment, open the printed URL in a private browser window, confirm Access requires login, and verify an allowed email can sign in with a PIN. Confirm another email is denied, dashboard deep links work, and a package baseline appears after an hourly collection. Local checks cannot verify live account permissions, Access propagation, email delivery, or scheduled execution.

References: [Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), [Zero Trust organization API](https://developers.cloudflare.com/api/typescript/resources/zero_trust/subresources/organizations/methods/create/), [email one-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/).

## Deploy button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FKamyab7%2FSourceMetric)

1. Open the button and choose your Cloudflare account and destination GitHub/GitLab repository.
2. Keep the project directory at the repository root: this is a pnpm workspace, and the root Wrangler configuration references the Vue and Worker folders.
3. Accept or set build command **pnpm run build** and deploy command **pnpm run deploy:manual**. Dependency installation uses pnpm and the committed lockfile.
4. Confirm the D1 resource. Cloudflare provisions the database and updates the top-level binding with its ID. The deploy script applies pending migrations through the binding name DB, so customized database names work.
5. Set ACCESS_TEAM_DOMAIN, ACCESS_AUD, and APP_ORIGIN if your Access application/domain already exist. Keep APP_ENV=production and DEMO_MODE=false.
6. If Access is not configured yet, complete steps 4–6 of the manual instructions below in your copied repository: add a custom domain and create an Access application with an explicit allow policy. Commit the updated production configuration and let Workers Builds redeploy.
7. Verify logged-out and logged-in access, then register a package.

The button provisions the Worker, D1 binding, Vue assets, Cron Trigger, and Workers Builds integration. It does **not** provision Access applications/policies or custom domains/DNS. Incomplete Access configuration rejects requests, and workers.dev/preview URLs stay disabled. No credentials are required for public NuGet statistics.

The button loads the version published on GitHub, so local changes must be pushed before they are available to users. No live deployment is performed by the local build or check:deploy command.

## Manual provision

1. Install dependencies and authenticate Wrangler using your preferred account method. Never commit tokens.
2. Create D1 with pnpm exec wrangler d1 create sourcemetric.
3. Copy its ID into the top-level D1 binding in wrangler.jsonc; preserve the separate local placeholder.
4. Choose a hostname on a Cloudflare-managed domain. Add a Workers custom-domain route with pattern set to that hostname and custom_domain set to true.
5. Create a Cloudflare Access self-hosted application protecting the **entire hostname**, including assets and /api. Allow only intended maintainers. Copy its audience (AUD).
6. Set top-level variables:
   - APP_ENV: production, never local.
   - APP_ORIGIN: exact HTTPS origin without trailing slash.
   - ACCESS_TEAM_DOMAIN: team.cloudflareaccess.com without a scheme.
   - ACCESS_AUD: the application's audience.
7. Apply migrations deliberately:

       pnpm exec wrangler d1 migrations apply sourcemetric --remote --env=""

8. Run checks, then pnpm deploy:manual. Deploy builds the Vue assets, applies pending remote D1 migrations through DB, and deploys the Worker. The explicit migration in step 7 is optional because deploy also runs it.
9. Confirm logged-out requests encounter Access, admitted users see the dashboard, and missing/invalid assertions are rejected by the Worker. Check deep links.
10. Add a package and verify the next scheduled invocation persists a baseline. Verify growth after another successful collection.

NuGet requires no credentials. Future provider credentials belong in Workers secrets, never D1 or committed configuration.

## Monitoring

Structured logs include collection_completed counts and elapsed wall time, plus safe collection_failed codes. Logs and sampled traces are enabled. Wall time is **not CPU time**.

Use Collection health for job state, attempts, successes, retry times, and observation counts. Review Workers CPU, subrequests, errors, and D1 reads/writes/storage in Cloudflare. No notification service is included.

Failures never replace observations with zeros. Unlisted packages remain tracked with errors; archive them to suspend retry. Restoring resumes collection when due.

## Backup and restoration

Export:

    pnpm exec wrangler d1 export sourcemetric --remote --env="" --output=/tmp/sourcemetric-backup.sql

Copy backups to your own durable storage. CSV is an analytical extract, not a database backup.

Restore into a **new empty database**, never a populated production database:

    pnpm exec wrangler d1 create sourcemetric-restore
    pnpm exec wrangler d1 execute sourcemetric-restore --remote --env="" --file=/tmp/sourcemetric-backup.sql

Verify projects, packages, observations, and migration records before switching bindings. Regenerate types and redeploy. Cloudflare Time Travel offers plan-dependent short-term recovery.

Worker rollback does not roll back D1 migrations. Future migrations should support the previous Worker during rollout. Back up before schema changes.

## Isolation

Local development uses .wrangler/state; Playwright uses .wrangler/e2e-state. Test bindings never reference remote resources. Production rejects missing Access configuration. There are no public data endpoints or badges.

References: [Deploy button setup](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Workers configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

## GitHub repository metrics

GitHub tracking is optional and does not affect NuGet collection. Create a fine-grained personal access token for the resource owner and select every repository you intend to track. Grant **Metadata: read** and **Administration: read** (needed for clone traffic). Your GitHub account also needs the repository access required by GitHub's traffic API. Organization approval or SSO policies may apply. A token belongs to one resource owner; track repositories it can access.

Store it as a Worker secret using `pnpm exec wrangler secret put GITHUB_TOKEN --env=""`. For local development put `GITHUB_TOKEN=...` in the ignored `.dev.vars.local` file. Never place tokens in Wrangler vars or browser settings. Rotate or renew the secret before token expiry. No application restart or database migration is needed after rotation; failed jobs retry or can be queued through Refresh.

Open **Repositories**, resolve an `owner/repo` name or HTTPS github.com URL, then track it and optionally select a project. Repositories can be shared across projects. Archive before permanently deleting history. Archiving retains data and frees an active slot; it does not stop an already running collection. All users admitted by Access can view all tracked data, including private repository names and counts.

Missing configuration, token access failures, rate limits, and partial traffic failures appear in Collection health. A metadata success with a traffic failure retains stars/forks and records a partial attempt. Repository HTTP responses never include the token or upstream error bodies.

Repository collection adds up to four jobs to each scheduled run in addition to the four package jobs. Validate combined CPU, subrequests, D1 statements, storage growth, and latency on staging using 20 packages and 20 repositories across at least two six-hour cycles. This change does not establish free-tier suitability; reduce the workload or upgrade if measured usage exceeds your plan. No live-account benchmark has been performed.

### Enable visitor and referral metrics

The existing GitHub token's **Administration: read** permission covers views, popular content, and referring sites; no additional secret or scope is required. Apply the additive D1 migrations through the normal deployment command. Collection will populate the new endpoints on the next due run; use Refresh to queue a repository earlier. Existing clone and star/fork history remains available, while new metrics have no fabricated pre-upgrade history beyond GitHub's available rolling window.

Collection health now shows last success and errors separately for clones, views, paths, and referrers. An overall partial attempt can contain successful metrics alongside failed/deferred endpoints. Old clone-specific status fields remain compatible. Historical snapshots are retained indefinitely and are removed only by confirmed repository-history deletion.

Before increasing a real deployment's workload, measure scheduled CPU, wall time, outgoing requests, D1 reads/writes/statements, and database growth across at least two six-hour cycles using representative packages and repositories. The three extra traffic endpoints and retained ranking snapshots add cost; production capacity remains unverified.
