# Architecture and extension

## Feature boundaries

A single Worker serves the Vue SPA and /api/v1. All requests, including assets, pass through Access JWT validation. Production uses an explicitly configured origin; workers.dev and preview URLs are disabled. Authenticated responses use private/no-store headers.

The Vue app lazy-loads pages and uses TanStack Vue Query for server state. Router parameters select workspace, project, or package scope. Local forms use Composition API state. Components call backend feature APIs, never NuGet directly.

Backend feature folders own routes, operations, and persistence. Projects and annotations use Drizzle for standard operations. Metrics and collection use prepared D1 SQL for window selection, lease fencing, and JSON batch inserts. No generic repository layer. Shared Zod contracts validate request fields and frontend response decoding. Generate binding types with pnpm types.

## API

| Resource under /api/v1            | Operations                                                             |
| --------------------------------- | ---------------------------------------------------------------------- |
| /projects                         | GET paginated list, POST create                                        |
| /projects/:id                     | PATCH name/archive                                                     |
| /projects/:id/packages/:packageId | PUT associate, DELETE unlink                                           |
| /packages/resolve                 | POST validate/resolve                                                  |
| /packages                         | GET paginated list, optionally projectId; POST register                |
| /packages/:id                     | GET details, PATCH archive/restore, DELETE history                     |
| /metrics                          | GET summary, series, versions, comparisons, notes                      |
| /annotations                      | GET paginated list, POST create                                        |
| /annotations/:id                  | PUT edit, DELETE                                                       |
| /sync                             | GET schedule, observation count, paginated attempts with package names |
| /sync/:id/refresh                 | POST queue with five-minute cooldown                                   |
| /exports                          | GET CSV                                                                |
| /health                           | GET authenticated health                                               |

Metrics/export require ISO from/to, optional projectId/packageId, and channel=all|stable|prerelease. Timestamps normalize to UTC. Ranges must be ordered and at most 366 days. Lists accept limit (1–100) and offset. The UI offers 10, 20, or 50 items per page and clamps empty final pages after deletion. Collection health accepts limit/offset for attempts and packageLimit/packageOffset for its independent schedule list; responses include attemptTotal and packageTotal. Selector lists load successive API pages instead of stopping at 100 records. Dashboard notes paginate their date-scoped chart context in the browser; dashboard versions use /metrics/versions so counters beyond the legacy 200-item snapshot remain accessible. Errors use an error object with code and message. Unknown API routes return JSON 404s.

Permanent deletion requires an archived package and confirm=delete-history query parameter. Foreign keys cascade to observations, versions, attempts, associations, and package notes.

## Collection consistency

Jobs persist next attempt, status, failures, refresh time, lease token, and expiry. The hourly scheduler selects four due active packages. Two runners claim jobs using conditional updates. Expired attempts become interrupted when reclaimed.

Successful collection uses one atomic batch for discovery notes, version metadata, observations, package metadata, attempt status, and job release. Every write is fenced by the lease token. JSON table-valued inserts keep query count independent of version count and avoid parameter limits. Old runners cannot overwrite a new claim.

Failures retain observations and persist a safe category with exponential retry (one hour to 24 hours), honoring Retry-After up to 24 hours. Runtime interruption leaves a five-minute lease recoverable on the next invocation. Manual refresh only marks due; it never bypasses a lease.

## Add a provider

1. Implement PackageProvider in a new adapter directory: capabilities, exact resolution, metadata, collection.
2. Declare cumulative versus interval counters. Missing values stay null; never fabricate daily counts.
3. Return canonical identity, metric, scope/version, observation time, source interval, availability, and quality.
4. Register the adapter in the explicit factory. Extend provider identifiers and capability fields in shared contracts and UI.
5. Add fixture tests for source failures, missing data, identity rules, and interval boundaries.
6. Review dashboard labels for provider capabilities. Interval-only sources need period downloads rather than a lifetime-counter label.

Only NuGet is implemented. It discovers its search endpoint, includes prereleases and SemVer 2, and exact-matches IDs case-insensitively. It trusts HTTPS nuget.org endpoints only, limits responses to 2 MB, and times out requests after 12 seconds. Unlisted packages are unavailable, never zero.

Adapters return the shared measurement model, not database rows. No registry inheritance hierarchy or placeholder npm/PyPI implementation is needed.

## Repository tracking

GitHub repository providers use a separate `RepositoryProvider` interface, not `PackageProvider`. `GITHUB_TOKEN` is an optional deployment secret. Repository identity uses the upstream numeric ID; collection resolves `/repositories/:id` and uses the returned current name for traffic. Requests only target api.github.com, validate redirects before resending credentials, enforce timeouts and a 2 MB response bound, and validate upstream metadata/buckets.

Additive repository tables store entities, project associations, jobs, attempts, snapshots, and clone days. Claim/attempt bookkeeping and success commits use atomic D1 batches with lease-token fences on every write; stale failures cannot overwrite a replacement attempt. The scheduler awaits both independently budgeted collectors even if one fails. Traffic-only errors commit metadata and a partial attempt; source retry/reset delays apply to the next attempt.

New `/api/v1` resources:

| Resource                                                      | Operations                                                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/repositories`, `/repositories/resolve`, `/repositories/:id` | Paginated list (optional projectId), register, resolve, get, archive/restore, confirmed archived history deletion |
| `/projects/:id/repositories/:repositoryId`                    | PUT associate, DELETE unlink                                                                                      |
| `/repository-metrics`                                         | GET with from/to and optional projectId/repositoryId; same 366-day maximum                                        |
| `/repository-exports`                                         | GET CSV using repository metric filters                                                                           |
| `/repository-sync`, `/repository-sync/:id/refresh`            | GET attempts and schedules, POST queue with five-minute cooldown                                                  |

Repository sync accepts `limit`/`offset` for attempts and `repositoryLimit`/`repositoryOffset` for schedules. Repository list selectors fetch every page. Package APIs and provider contracts remain compatible. Demo mode blocks all mutations before adapters run and bypasses both scheduled collectors.

### Visitor traffic and rolling snapshots

The GitHub adapter collects clones, daily views, popular paths, and referrers sequentially within each repository runner. Each endpoint returns an independent result. Rate limiting defers remaining endpoints and suppresses further requests through that adapter instance for the remainder of the retry window. Successful endpoints commit even when others fail. Overall attempts/jobs report partial failures; legacy `trafficSuccess`/`trafficError` remain clone-specific.

Migration `0003_repository_traffic.sql` adds daily view buckets, rolling traffic snapshots, and per-endpoint status. JSON arrays preserve source top-10 rankings, including successful empty lists. Snapshots are unique by repository/metric/collection timestamp. All new writes share the collection's atomic batch and lease fences. Repository deletion cascades to every new table. The migration initializes clone endpoint status from existing records without inventing historical view or ranking data.

`GET /repository-metrics` adds `views` (total, completeness, comparison) and `viewDays` (per-repository daily counts and unique visitors). Existing fields retain their meanings. `GET /repository-sync` adds `trafficStatuses` for the displayed repository schedule page.

| Resource under `/api/v1`            | Behavior                                                                                                                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/repository-traffic`               | Existing repository range/scope filters and limit/offset; paginates repository groups, with the latest successful summary per metric at/before `to`, plus current endpoint health. No historical item arrays are loaded.                        |
| `/repository-traffic/history`       | Required repositoryId, metric (`views`, `paths`, `referrers`), from/to and pagination; lists summary history newest first at/before `to`, including snapshots earlier than `from` for inspecting stale history.                                 |
| `/repository-traffic/snapshots/:id` | One saved snapshot with its source items and ranking order.                                                                                                                                                                                     |
| `/repository-traffic-exports`       | Existing range/scope filters and optional metric; exports snapshots collected within from/to, including empty lists. Rejects more than 50,000 expanded data rows or snapshots, or an estimated payload above 8 MiB, before loading item arrays. |

All routes retain existing authentication and read-only demo behavior. Lists use the existing 1–100 page limits and ranges retain the 366-day maximum. Historical ranking snapshots are never aggregated across collections or repositories.
