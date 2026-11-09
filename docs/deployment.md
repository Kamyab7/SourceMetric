# Deployment and operations

## Provision

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

8. Run checks, then pnpm deploy.
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

References: [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Workers configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).
