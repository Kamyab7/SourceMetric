# Measurements and capacity

## Semantics

Downloads are not unique users, active installations, or attributable conversions. No pre-tracking history is backfilled. The first counter establishes a baseline.

Growth is the difference between consecutive valid counters of the same package/version. Missing values stay null. A decrease is a correction and a new baseline. More than seven hours between observations is flagged as a gap; growth belongs to that entire interval, never fabricated intervening days.

Charts place interval growth at the ending observation; tooltips identify boundaries and quality. Missing/correction observations do not become zero. Project associations never duplicate package totals.

Observed growth sums available, fully contained measured intervals, even with partial coverage. It is not an exact period total. Complete coverage and comparison are conservative: they require a baseline at/before the start, fully contained valid intervals, no gaps/corrections/missing counters, and a final observation within seven hours of the end. A boundary-crossing interval cannot be allocated exactly and makes the period incomplete for comparison. Ranges not aligned with collection times may therefore show partial coverage and N/A comparison, while measured interval growth remains visible and exportable. Percentage comparisons require two complete periods and a nonzero previous value.

Stable/prerelease summaries aggregate available version counters. Newly discovered versions establish independent baselines. Version distributions show up to 200 returned versions with timestamps, not inferred missing counters. NuGet package totals can differ from available-version sums.

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
