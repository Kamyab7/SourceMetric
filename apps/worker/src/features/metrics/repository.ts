import type { MetricRange, Annotation } from '@sourcemetric/contracts';
import type { ObservationRow } from './calculations';
export async function metricPackages(db: D1Database, range: MetricRange) {
  const conditions = [range.packageId ? '1=1' : 'p.archived=0'],
    params: string[] = [];
  if (range.packageId) {
    conditions.push('p.id=?');
    params.push(range.packageId);
  }
  if (range.projectId) {
    conditions.push(
      'EXISTS(SELECT 1 FROM project_packages a WHERE a.package_id=p.id AND a.project_id=?)',
    );
    params.push(range.projectId);
  }
  return (
    await db
      .prepare(
        'SELECT p.id,p.created_at,p.last_success FROM packages p WHERE ' + conditions.join(' AND '),
      )
      .bind(...params)
      .all<{ id: string; created_at: string; last_success: string | null }>()
  ).results;
}
export async function metricData(db: D1Database, range: MetricRange, includeVersions = false) {
  const packages = await metricPackages(db, range);
  const ids = packages.map((p) => p.id);
  if (!ids.length)
    return {
      packages,
      rows: [] as ObservationRow[],
      annotations: [] as Annotation[],
      truncated: false,
    };
  const placeholders = ids.map(() => '?').join(',');
  const from = new Date(
    Date.parse(range.from) - (Date.parse(range.to) - Date.parse(range.from)),
  ).toISOString();

  const channelFilter =
    range.channel === 'all' ? '' : ' AND v.prerelease=' + (range.channel === 'prerelease' ? 1 : 0);
  const scope =
    includeVersions && range.channel === 'all'
      ? '1=1'
      : range.channel === 'all'
        ? "o.scope='package'"
        : "o.scope='version' AND EXISTS(SELECT 1 FROM package_versions v WHERE v.package_id=o.package_id AND v.version=o.version" +
          channelFilter +
          ')';
  const rows = await db
    .prepare(
      'SELECT o.* FROM observations o WHERE o.package_id IN (' +
        placeholders +
        ') AND ' +
        scope +
        ' AND o.observed_at>=? AND o.observed_at<=? ORDER BY o.observed_at,o.id LIMIT 50001',
    )
    .bind(...ids, from, range.to)
    .all<ObservationRow>();
  const versionSeries =
    "SELECT v.package_id,v.version,'version' FROM package_versions v WHERE v.package_id IN (" +
    placeholders +
    ')' +
    channelFilter;
  const packageSeries = "SELECT id,'','package' FROM packages WHERE id IN (" + placeholders + ')';
  const series =
    includeVersions && range.channel === 'all'
      ? packageSeries + ' UNION ALL ' + versionSeries
      : range.channel === 'all'
        ? packageSeries
        : versionSeries;
  const seriesParams = includeVersions && range.channel === 'all' ? [...ids, ...ids] : ids;
  // Enumerate known series and use indexed point lookups instead of scanning old history.
  const baselines = await db
    .prepare(
      'WITH series(package_id,version,scope) AS (' +
        series +
        ') SELECT o.* FROM series s JOIN observations o ON o.id=(' +
        "SELECT b.id FROM observations b WHERE b.package_id=s.package_id AND b.metric='downloads' AND b.scope=s.scope AND b.version=s.version AND b.observed_at<? AND b.value IS NOT NULL ORDER BY b.observed_at DESC LIMIT 1) LIMIT 50001",
    )
    .bind(...seriesParams, from)
    .all<ObservationRow>();
  const combined = [...baselines.results, ...rows.results].sort((a, b) =>
    a.observed_at.localeCompare(b.observed_at),
  );
  const notes = await db
    .prepare(
      `SELECT DISTINCT n.id,n.project_id projectId,n.package_id packageId,n.kind,n.title,n.body,n.occurred_at occurredAt,n.automatic FROM annotations n
 WHERE occurred_at>=? AND occurred_at<=? AND (package_id IN (${placeholders}) OR ${range.projectId ? 'project_id=?' : range.packageId ? '0' : 'project_id IN (SELECT project_id FROM project_packages WHERE package_id IN (' + placeholders + '))'}) ORDER BY occurred_at`,
    )
    .bind(
      range.from,
      range.to,
      ...ids,
      ...(range.projectId ? [range.projectId] : range.packageId ? [] : ids),
    )
    .all<Annotation>();
  return {
    packages,
    rows: combined.slice(0, 50000),
    annotations: notes.results.map((n) => ({ ...n, automatic: !!n.automatic })),
    truncated: combined.length > 50000,
  };
}
export async function versionDistribution(
  db: D1Database,
  ids: string[],
  to: string,
  channel: MetricRange['channel'],
) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const filter =
    channel === 'all'
      ? ''
      : ` AND EXISTS(SELECT 1 FROM package_versions v WHERE v.package_id=o.package_id AND v.version=o.version AND v.prerelease=${channel === 'prerelease' ? 1 : 0})`;
  return (
    await db
      .prepare(
        `SELECT o.package_id packageId,o.version,o.value downloads,o.observed_at observedAt FROM observations o
 WHERE o.package_id IN (${placeholders}) AND o.scope='version' AND o.observed_at<=? AND o.value IS NOT NULL ${filter}
 AND o.observed_at=(SELECT MAX(b.observed_at) FROM observations b WHERE b.package_id=o.package_id AND b.scope='version' AND b.version=o.version AND b.observed_at<=?)
 ORDER BY o.value DESC LIMIT 200`,
      )
      .bind(...ids, to, to)
      .all<{ packageId: string; version: string; downloads: number; observedAt: string }>()
  ).results;
}

export async function pagedVersions(
  db: D1Database,
  range: MetricRange,
  limit: number,
  offset: number,
) {
  const ids = (await metricPackages(db, range)).map((p) => p.id);
  if (!ids.length) return { items: [], total: 0 };
  const marks = ids.map(() => '?').join(',');
  const channel =
    range.channel === 'all' ? '' : ' AND v.prerelease=' + (range.channel === 'prerelease' ? 1 : 0);
  const source =
    " FROM package_versions v JOIN observations o ON o.id=(SELECT b.id FROM observations b WHERE b.package_id=v.package_id AND b.metric='downloads' AND b.scope='version' AND b.version=v.version AND b.observed_at<=? ORDER BY b.observed_at DESC,b.id DESC LIMIT 1) WHERE v.package_id IN (" +
    marks +
    ') AND o.value IS NOT NULL' +
    channel;
  const [rows, total] = await Promise.all([
    db
      .prepare(
        'SELECT v.package_id packageId,v.version,o.value downloads,o.observed_at observedAt' +
          source +
          ' ORDER BY o.value DESC,v.package_id,v.version LIMIT ? OFFSET ?',
      )
      .bind(range.to, ...ids, limit, offset)
      .all(),
    db
      .prepare('SELECT COUNT(*) n' + source)
      .bind(range.to, ...ids)
      .first<{ n: number }>(),
  ]);
  return { items: rows.results, total: total?.n ?? 0 };
}
