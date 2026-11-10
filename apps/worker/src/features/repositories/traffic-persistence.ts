import type { RepositoryCollection } from '../../providers/github/provider';
export function trafficOutcome(result: RepositoryCollection) {
  const results = [result.traffic, result.views, result.paths, result.referrers].filter(
    (r) => r !== undefined,
  );
  return {
    error: results.find((r) => r.error)?.error ?? null,
    retryAfter: Math.max(0, ...results.map((r) => ('retryAfter' in r ? r.retryAfter : 0) ?? 0)),
  };
}
export function trafficStatements(
  db: D1Database,
  id: string,
  token: string,
  iso: string,
  result: RepositoryCollection,
) {
  const guard = 'EXISTS(SELECT 1 FROM repository_jobs WHERE repository_id=? AND lease_token=?)';
  const statuses = [{ metric: 'clones', error: result.traffic.error, deferred: false }];
  const snapshots: {
    id: string;
    metric: string;
    count: number | null;
    uniques: number | null;
    items: unknown[];
  }[] = [];
  for (const metric of ['views', 'paths', 'referrers'] as const) {
    const endpoint = result[metric];
    if (!endpoint) continue;
    statuses.push({
      metric,
      error: endpoint.error,
      deferred: 'deferred' in endpoint && !!endpoint.deferred,
    });
    if (endpoint.error === null) {
      const views = metric === 'views' ? result.views?.data : null;
      snapshots.push({
        id: crypto.randomUUID(),
        metric,
        count: views?.count ?? null,
        uniques: views?.uniques ?? null,
        items:
          metric === 'views'
            ? []
            : metric === 'paths'
              ? result.paths!.data!
              : result.referrers!.data!,
      });
    }
  }
  return [
    db
      .prepare(
        `INSERT INTO repository_views(repository_id,day,count,uniques,observed_at,provisional)
      SELECT ?,json_extract(value,'$.day'),json_extract(value,'$.count'),json_extract(value,'$.uniques'),?,CASE WHEN json_extract(value,'$.day')>=? THEN 1 ELSE 0 END
      FROM json_each(?) WHERE ${guard}
      ON CONFLICT(repository_id,day) DO UPDATE SET count=excluded.count,uniques=excluded.uniques,observed_at=excluded.observed_at,provisional=excluded.provisional WHERE excluded.observed_at>=repository_views.observed_at`,
      )
      .bind(
        id,
        iso,
        iso.slice(0, 10) + 'T00:00:00.000Z',
        JSON.stringify(result.views?.data?.days ?? []),
        id,
        token,
      ),
    db
      .prepare(
        `INSERT INTO repository_traffic_snapshots(id,repository_id,metric,observed_at,window_days,count,uniques,items)
      SELECT json_extract(value,'$.id'),?,json_extract(value,'$.metric'),?,14,json_extract(value,'$.count'),json_extract(value,'$.uniques'),json_extract(value,'$.items')
      FROM json_each(?) WHERE ${guard} ON CONFLICT(repository_id,metric,observed_at) DO NOTHING`,
      )
      .bind(id, iso, JSON.stringify(snapshots), id, token),
    db
      .prepare(
        `INSERT INTO repository_traffic_status(repository_id,metric,last_attempt,last_success,status,error)
      SELECT ?,json_extract(value,'$.metric'),?,CASE WHEN json_extract(value,'$.error') IS NULL THEN ? ELSE NULL END,
      CASE WHEN json_extract(value,'$.deferred')=1 THEN 'deferred' WHEN json_extract(value,'$.error') IS NULL THEN 'success' ELSE 'failed' END,json_extract(value,'$.error')
      FROM json_each(?) WHERE ${guard}
      ON CONFLICT(repository_id,metric) DO UPDATE SET last_attempt=excluded.last_attempt,last_success=COALESCE(excluded.last_success,repository_traffic_status.last_success),status=excluded.status,error=excluded.error`,
      )
      .bind(id, iso, iso, JSON.stringify(statuses), id, token),
  ];
}
