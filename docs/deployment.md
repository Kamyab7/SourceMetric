# Deployment and operations

## Deploy button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FKamyab7%2FSourceMetric)

1. Open the button and choose your Cloudflare account and destination GitHub/GitLab repository.
2. Keep the project directory at the repository root: this is a pnpm workspace, and the root Wrangler configuration references the Vue and Worker folders.
3. Accept or set build command **pnpm run build** and deploy command **pnpm run deploy**. Dependency installation uses pnpm and the committed lockfile.
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

8. Run checks, then pnpm deploy. Deploy builds the Vue assets, applies pending remote D1 migrations through DB, and deploys the Worker. The explicit migration in step 7 is optional because deploy also runs it.
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
