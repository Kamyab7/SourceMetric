import type { RepositoryMetrics, RepositoryRange } from '@sourcemetric/contracts';
import { mapRepository, repositoryScope } from './repository';
const DAY = 86400000,
  GAP = 7 * 3600000,
  LIMIT = 50000;
type Snapshot = RepositoryMetrics['snapshots'][number];
type Clone = RepositoryMetrics['days'][number];
const percent = (value: number | null, previous: number | null, complete: boolean) =>
  complete && value !== null && previous !== null && previous !== 0
    ? ((value - previous) / Math.abs(previous)) * 100
    : null;
export function gaugeSummary(
  ids: string[],
  snapshots: Snapshot[],
  from: string,
  to: string,
  metric: 'stars' | 'forks',
) {
  let latest = 0,
    change = 0,
    hasChange = false,
    allLatest = ids.length > 0,
    complete = ids.length > 0;
  for (const id of ids) {
    const points = snapshots
      .filter((p) => p.repositoryId === id && p.observedAt <= to)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const last = points.at(-1);
    if (last) latest += last[metric];
    else allLatest = false;
    const inside = points.filter((p) => p.observedAt >= from);
    if (inside.length >= 2) {
      change += inside.at(-1)![metric] - inside[0]![metric];
      hasChange = true;
    }
    if (
      !inside.length ||
      inside[0]!.observedAt !== from ||
      !last ||
      Date.parse(to) - Date.parse(last.observedAt) > GAP
    )
      complete = false;
    for (let i = 1; i < inside.length; i++)
      if (Date.parse(inside[i]!.observedAt) - Date.parse(inside[i - 1]!.observedAt) > GAP)
        complete = false;
  }
  return { latest: allLatest ? latest : null, change: hasChange ? change : null, complete };
}
export function cloneSummary(ids: string[], days: Clone[], from: string, to: string) {
  const start = Date.parse(from),
    end = Date.parse(to);
  const contained = days.filter(
    (d) => Date.parse(d.day) >= start && Date.parse(d.day) + DAY <= end && !d.provisional,
  );
  const complete =
    ids.length > 0 &&
    start % DAY === 0 &&
    end % DAY === 0 &&
    contained.length === (ids.length * (end - start)) / DAY;
  return {
    total: contained.length ? contained.reduce((sum, d) => sum + d.count, 0) : null,
    complete,
  };
}
export async function repositoryMetrics(
  db: D1Database,
  range: RepositoryRange,
): Promise<RepositoryMetrics> {
  const { where, params } = repositoryScope(range.projectId, range.repositoryId);
  const previousFrom = new Date(2 * Date.parse(range.from) - Date.parse(range.to)).toISOString();
  const repos = (
    await db
      .prepare(
        `SELECT r.*,j.last_attempt,j.next_attempt,j.last_error,j.status FROM repositories r JOIN repository_jobs j ON j.repository_id=r.id${where} ORDER BY r.full_name,r.id`,
      )
      .bind(...params)
      .all<Record<string, unknown>>()
  ).results.map(mapRepository);
  const scope = `SELECT r.id FROM repositories r${where}`;
  const [snapshotRows, cloneRows] = await Promise.all([
    db
      .prepare(
        `SELECT s.repository_id repositoryId,s.observed_at observedAt,s.stars,s.forks FROM repository_snapshots s
      WHERE s.repository_id IN (${scope}) AND s.observed_at<=? AND (s.observed_at>=? OR s.observed_at=(SELECT MAX(b.observed_at) FROM repository_snapshots b WHERE b.repository_id=s.repository_id AND b.observed_at<?))
      ORDER BY s.repository_id,s.observed_at LIMIT ?`,
      )
      .bind(...params, range.to, previousFrom, previousFrom, LIMIT + 1)
      .all<Snapshot>(),
    db
      .prepare(
        `SELECT repository_id repositoryId,day,count,uniques,observed_at observedAt,provisional FROM repository_clones
      WHERE repository_id IN (${scope}) AND day>=? AND day<? ORDER BY repository_id,day LIMIT ?`,
      )
      .bind(...params, previousFrom.slice(0, 10) + 'T00:00:00.000Z', range.to, LIMIT + 1)
      .all<Omit<Clone, 'provisional'> & { provisional: number }>(),
  ]);
  const truncated = snapshotRows.results.length + cloneRows.results.length > LIMIT;
  const snapshots = snapshotRows.results.slice(0, LIMIT);
  const days = cloneRows.results
    .slice(0, Math.max(0, LIMIT - snapshots.length))
    .map((d) => ({ ...d, provisional: !!d.provisional }));
  const ids = repos.map((r) => r.id);
  const gauge = (metric: 'stars' | 'forks') => {
    const current = gaugeSummary(ids, snapshots, range.from, range.to, metric),
      previous = gaugeSummary(ids, snapshots, previousFrom, range.from, metric);
    return {
      ...current,
      complete: current.complete && !truncated,
      comparison: percent(
        current.change,
        previous.change,
        current.complete && previous.complete && !truncated,
      ),
    };
  };
  const clones = cloneSummary(ids, days, range.from, range.to),
    previous = cloneSummary(ids, days, previousFrom, range.from);
  // Keep one baseline at/before the requested start for each series, not the previous comparison period.
  const baselines = new Map<string, string>();
  for (const p of snapshots)
    if (p.observedAt < range.from) baselines.set(p.repositoryId, p.observedAt);
  const displayed = snapshots.filter(
    (p) => p.observedAt >= range.from || p.observedAt === baselines.get(p.repositoryId),
  );
  return {
    from: range.from,
    to: range.to,
    repositories: repos,
    stars: gauge('stars'),
    forks: gauge('forks'),
    clones: {
      ...clones,
      complete: clones.complete && !truncated,
      comparison: percent(
        clones.total,
        previous.total,
        clones.complete && previous.complete && !truncated,
      ),
    },
    snapshots: displayed,
    days: days.filter((d) => Date.parse(d.day) + DAY > Date.parse(range.from)),
    truncated,
  };
}
