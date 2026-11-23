import { z } from 'zod';
import { cloudflareUsageSchema, type CloudflareUsageMetric } from '@sourcemetric/contracts';

// Free tier allowances, verified against Cloudflare documentation on 2026-11-23.
const definitions = [
  ['worker-requests', 'Worker requests', 100_000, 'count', 'daily', 'account'],
  ['d1-reads', 'D1 rows read', 5_000_000, 'count', 'daily', 'account'],
  ['d1-writes', 'D1 rows written', 100_000, 'count', 'daily', 'account'],
  ['d1-storage', 'D1 database storage', 500_000_000, 'bytes', 'storage', 'database'],
  ['kv-reads', 'KV keys read', 100_000, 'count', 'daily', 'account'],
  ['kv-writes', 'KV keys written', 1_000, 'count', 'daily', 'account'],
  ['kv-deletes', 'KV keys deleted', 1_000, 'count', 'daily', 'account'],
  ['kv-lists', 'KV list requests', 1_000, 'count', 'daily', 'account'],
  ['kv-storage', 'KV stored data', 1_000_000_000, 'bytes', 'storage', 'account'],
] as const;
const count = z.number().finite().nonnegative();
const workers = z.array(z.object({ sum: z.object({ requests: count }) }));
const d1 = z.array(z.object({ sum: z.object({ rowsRead: count, rowsWritten: count }) }));
const kv = z.array(
  z.object({
    sum: z.object({ requests: count }),
    dimensions: z.object({ actionType: z.string() }),
  }),
);
const storage = z.array(
  z.object({ max: z.object({ bytes: count }), dimensions: z.object({ date: z.iso.date() }) }),
);

export async function cloudflareUsage(env: Env, fetcher: typeof fetch = fetch, now = new Date()) {
  const fetchedAt = now.toISOString();
  const day = fetchedAt.slice(0, 10);
  const periodStart = day + 'T00:00:00.000Z';
  const demo = env.APP_ENV === 'local' && env.DEMO_MODE === 'true';
  const configured = Boolean(
    env.CLOUDFLARE_ANALYTICS_API_TOKEN &&
    env.CLOUDFLARE_ACCOUNT_ID &&
    env.CLOUDFLARE_WORKER_NAME &&
    env.CLOUDFLARE_D1_DATABASE_ID &&
    env.CLOUDFLARE_KV_NAMESPACE_ID,
  );
  const metrics: CloudflareUsageMetric[] = definitions.map(
    ([id, label, allowance, unit, period, allowanceScope]) => ({
      id,
      label,
      allowance,
      unit,
      period,
      allowanceScope,
      status: 'unavailable',
      used: null,
      remaining: null,
      percent: null,
      measuredAt: null,
      message: configured
        ? 'Cloudflare analytics is unavailable. Check the analytics token permissions and retry.'
        : 'Usage reporting is not configured.',
    }),
  );
  function set(id: string, used: number, measuredAt: string) {
    const metric = metrics.find((m) => m.id === id)!;
    Object.assign(metric, {
      used,
      remaining: Math.max(0, metric.allowance - used),
      percent: (used / metric.allowance) * 100,
      measuredAt,
      status: 'available',
      message: null,
    });
  }
  async function query<T extends z.ZodType>(
    selection: string,
    variables: Record<string, string | undefined>,
    types: string,
    schema: T,
  ): Promise<z.infer<T>> {
    const response = await fetcher('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        query: `query Usage($account: string!, ${types}) { viewer { accounts(filter: {accountTag: $account}) { rows: ${selection} } } }`,
        variables: { account: env.CLOUDFLARE_ACCOUNT_ID, ...variables },
      }),
    });
    if (!response.ok) throw new Error('Analytics unavailable');
    const envelope = z
      .object({
        errors: z.array(z.unknown()).nullish(),
        data: z
          .object({
            viewer: z.object({ accounts: z.array(z.object({ rows: z.unknown() })).length(1) }),
          })
          .nullish(),
      })
      .parse(await response.json());
    if (envelope.errors?.length || !envelope.data) throw new Error('Analytics unavailable');
    return schema.parse(envelope.data.viewer.accounts[0]!.rows);
  }
  async function latestStorage(
    dataset: string,
    filter: string,
    id: string | undefined,
    field: string,
    metric: string,
  ) {
    const rows = await query(
      `${dataset}(limit: 1, orderBy: [date_DESC], filter: {${filter}: $id, date_geq: $start, date_leq: $end}) { max { bytes: ${field} } dimensions { date } }`,
      { id, start: new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10), end: day },
      '$id: string!, $start: Date!, $end: Date!',
      storage,
    );
    if (rows.length) set(metric, rows[0]!.max.bytes, rows[0]!.dimensions.date + 'T00:00:00.000Z');
    else
      metrics.find((m) => m.id === metric)!.message =
        'No storage measurement is available in the last 31 days.';
  }
  if (demo) {
    metrics.forEach((metric, index) =>
      set(metric.id, Math.round((metric.allowance * (index + 1)) / 20), fetchedAt),
    );
  } else if (configured) {
    // Each dataset fails independently; never return upstream bodies or error messages.
    await Promise.allSettled([
      (async () => {
        const rows = await query(
          'workersInvocationsAdaptive(limit: 1, filter: {scriptName: $id, datetime_geq: $start, datetime_leq: $end}) { sum { requests } }',
          { id: env.CLOUDFLARE_WORKER_NAME, start: periodStart, end: fetchedAt },
          '$id: string!, $start: string!, $end: string!',
          workers,
        );
        set(
          'worker-requests',
          rows.reduce((n, row) => n + row.sum.requests, 0),
          fetchedAt,
        );
      })(),
      (async () => {
        const rows = await query(
          'd1AnalyticsAdaptiveGroups(limit: 1, filter: {databaseId: $id, date_geq: $day, date_leq: $day}) { sum { rowsRead rowsWritten } }',
          { id: env.CLOUDFLARE_D1_DATABASE_ID, day },
          '$id: string!, $day: Date!',
          d1,
        );
        set(
          'd1-reads',
          rows.reduce((n, row) => n + row.sum.rowsRead, 0),
          fetchedAt,
        );
        set(
          'd1-writes',
          rows.reduce((n, row) => n + row.sum.rowsWritten, 0),
          fetchedAt,
        );
      })(),
      latestStorage(
        'd1StorageAdaptiveGroups',
        'databaseId',
        env.CLOUDFLARE_D1_DATABASE_ID,
        'databaseSizeBytes',
        'd1-storage',
      ),
      (async () => {
        const rows = await query(
          'kvOperationsAdaptiveGroups(limit: 100, filter: {namespaceId: $id, date_geq: $day, date_leq: $day}) { sum { requests } dimensions { actionType } }',
          { id: env.CLOUDFLARE_KV_NAMESPACE_ID, day },
          '$id: string!, $day: Date!',
          kv,
        );
        if (rows.length >= 100) throw new Error('Truncated analytics');
        for (const [action, metric] of [
          ['read', 'kv-reads'],
          ['write', 'kv-writes'],
          ['delete', 'kv-deletes'],
          ['list', 'kv-lists'],
        ]) {
          set(
            metric!,
            rows
              .filter((r) => r.dimensions.actionType === action)
              .reduce((n, row) => n + row.sum.requests, 0),
            fetchedAt,
          );
        }
      })(),
      latestStorage(
        'kvStorageAdaptiveGroups',
        'namespaceId',
        env.CLOUDFLARE_KV_NAMESPACE_ID,
        'byteCount',
        'kv-storage',
      ),
    ]);
  }
  return cloudflareUsageSchema.parse({
    configured: configured || demo,
    demo,
    fetchedAt,
    periodStart,
    periodEnd: fetchedAt,
    resetsAt: new Date(Date.parse(periodStart) + 86400000).toISOString(),
    metrics,
  });
}
