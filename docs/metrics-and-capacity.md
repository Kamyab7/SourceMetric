# Measurements and capacity

## Semantics

Downloads are not unique users, active installations, or attributable conversions. No pre-tracking history is backfilled. The first counter establishes a baseline.

Growth is the difference between consecutive valid counters of the same package/version. Missing values stay null. A decrease is a correction and a new baseline. More than seven hours between observations is flagged as a gap; growth belongs to that entire interval, never fabricated intervening days.

Charts place interval growth at the ending observation; tooltips identify boundaries and quality. Missing/correction observations do not become zero. Project associations never duplicate package totals.

Observed growth sums available, fully contained measured intervals, even with partial coverage. It is not an exact period total. Complete coverage and comparison are conservative: they require a baseline at/before the start, fully contained valid intervals, no gaps/corrections/missing counters, and a final observation within seven hours of the end. A boundary-crossing interval cannot be allocated exactly and makes the period incomplete for comparison. Ranges not aligned with collection times may therefore show partial coverage and N/A comparison, while measured interval growth remains visible and exportable. Percentage comparisons require two complete periods and a nonzero previous value.

Stable/prerelease summaries aggregate available version counters. Newly discovered versions establish independent baselines. The version table is paginated through all available returned versions with timestamps, not inferred missing counters. The combined metrics response retains its legacy 200-version snapshot; the dashboard uses the separate paginated version endpoint. NuGet package totals can differ from available-version sums.

Queries cap at 50,000 observation rows and flag truncation, suppressing exact comparisons. CSV rejects oversized exports rather than silently truncating; select shorter ranges or individual packages.

## Capacity target

Defaults: 20 active packages, approximately four collections/package/day, indefinite observation retention. Archiving frees an active slot but preserves storage.

With 100 versions per package:

- 80 collections/day.
- 8,080 new observations/day.
- Approximately 2.95 million observations/year, before attempts, annotations, and indexes.
- At an illustrative 300–600 bytes/observation including indexes, roughly 0.9–1.8 GB/year. Measure actual SQLite growth.

Free D1 currently has a **500 MB per-database** limit despite its 5 GB account allowance. This single-database design can reach the limit well before one year at this example workload. Indefinite retention does not mean perpetual free hosting.

The collector uses four jobs/invocation and concurrency two, below the planned maximum of five. Bulk JSON inserts avoid per-version SQL statements. All-success collection uses at most 37 D1 statements (one due query plus nine/package) and up to eight cold registry requests; batches reduce network round trips. JSON serialization and source parsing can still exceed Free Worker CPU limits.

## Validation and remaining benchmark

Local fixture tests process 20 packages with 100 versions each in five bounded invocations, verifying 2,020 stored observations. This validates batching and progress, **not production CPU, billable write counts, real latency, or free-tier feasibility**.

Before declaring the free-tier target achieved:

1. Deploy an Access-protected staging instance on your own account.
2. Register 20 representative packages, including high-version-count packages.
3. Run at least two six-hour cycles.
4. Record scheduled CPU, wall time, subrequests, errors, registry calls, D1 reads/writes, and database size deltas.
5. Check plan limits and estimate retention from measured storage growth.
6. Lower batch size or upgrade Worker CPU capacity if necessary. Export/delete explicitly or upgrade storage when needed; never silently discard observations.

No live Cloudflare account was configured during implementation. Production benchmarking remains outstanding.

References: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [NuGet counters](https://learn.microsoft.com/en-us/nuget/api/search-query-service-resource).

## GitHub repository measurements

Repository metrics are separate from NuGet downloads. Stars and forks are six-hour snapshots, identified by immutable GitHub repository ID. Rename/transfer updates the display name and URL without splitting history. Declines are valid net changes, not counter corrections. No star/fork history before registration is inferred.

Latest counts are the latest snapshot at/before range end (null if a selected repository has none). Net change sums the last-minus-first values between snapshots **inside** the selected range. A single observation establishes a baseline, not growth. Complete gauge coverage requires every selected repository to have a snapshot exactly at range start, no internal gap over seven hours, and a final snapshot within seven hours of range end. Otherwise observed change may be partial; missing observations are never zero. Percentage comparisons require complete current and previous equal-duration periods and a nonzero previous change.

Clone traffic is fetched as UTC daily buckets from GitHub's rolling 14-day window and upserted by repository/day. Later source revisions replace existing bucket values; overlapping polls never add counts. Saved buckets remain after they disappear from GitHub's window. Missing buckets remain unknown, even if GitHub omits a zero-activity day. Current-day buckets are provisional until collected again on a later day; an unrevisited bucket remains provisional conservatively.

Clone totals include only fully contained, non-provisional UTC days. Complete coverage requires UTC-midnight boundaries and one finalized bucket per repository/day. Partial totals sum only the available finalized buckets. Daily unique cloners are charted and exported per repository/day and never added into a range-wide or workspace-wide unique-person total. They must not be interpreted as unique users or installations. Traffic unavailable for over 14 days can leave permanent gaps.

Workspace/project scopes deduplicate repositories by tracked ID. Archived resources retain their historical metrics. Exports include source, repository identity, observation timestamps, daily interval boundaries, and quality labels. Queries cap combined comparison/current observations at 50,000 rows; truncated dashboards disable completeness/comparisons and CSV exports reject the range. Shorten the range or select one repository.

Repository jobs have their own limit of four per hourly invocation, concurrency two, six-hour cadence, and 20 active repositories. Snapshot storage grows by roughly 80 rows/day at that capacity, plus up to 20 daily clone rows/day and attempt history. Overlapping traffic refreshes update rows rather than append duplicate days. Package version observations remain the larger storage driver. Combined production CPU, D1 usage, and storage require staging measurement.

Sources: [GitHub repository metadata](https://docs.github.com/en/rest/repos/repos#get-a-repository), [GitHub clone traffic and permissions](https://docs.github.com/en/rest/metrics/traffic#get-repository-clones).
