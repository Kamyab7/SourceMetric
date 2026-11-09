# Architecture and extension

## Feature boundaries

A single Worker serves the Vue SPA and /api/v1. All requests, including assets, pass through Access JWT validation. Production uses an explicitly configured origin; workers.dev and preview URLs are disabled. Authenticated responses use private/no-store headers.

The Vue app lazy-loads pages and uses TanStack Vue Query for server state. Router parameters select workspace, project, or package scope. Local forms use Composition API state. Components call backend feature APIs, never NuGet directly.

Backend feature folders own routes, operations, and persistence. Projects and annotations use Drizzle for standard operations. Metrics and collection use prepared D1 SQL for window selection, lease fencing, and JSON batch inserts. No generic repository layer. Shared Zod contracts validate request fields and frontend response decoding. Generate binding types with pnpm types.

## API

| Resource under /api/v1            | Operations                                              |
| --------------------------------- | ------------------------------------------------------- |
| /projects                         | GET paginated list, POST create                         |
| /projects/:id                     | PATCH name/archive                                      |
| /projects/:id/packages/:packageId | PUT associate, DELETE unlink                            |
| /packages/resolve                 | POST validate/resolve                                   |
| /packages                         | GET paginated list, optionally projectId; POST register |
| /packages/:id                     | GET details, PATCH archive/restore, DELETE history      |
| /metrics                          | GET summary, series, versions, comparisons, notes       |
| /annotations                      | GET paginated list, POST create                         |
| /annotations/:id                  | PUT edit, DELETE                                        |
| /sync                             | GET schedule, observation count, 50 recent attempts     |
| /sync/:id/refresh                 | POST queue with five-minute cooldown                    |
| /exports                          | GET CSV                                                 |
| /health                           | GET authenticated health                                |

Metrics/export require ISO from/to, optional projectId/packageId, and channel=all|stable|prerelease. Timestamps normalize to UTC. Ranges must be ordered and at most 366 days. Lists accept limit (1–100) and offset. Errors use an error object with code and message. Unknown API routes return JSON 404s.

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
