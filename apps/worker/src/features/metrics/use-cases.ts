import type { MetricRange, MetricPoint, Metrics } from '@sourcemetric/contracts';
import { metricData, versionDistribution } from './repository';
import { derivePoints, period, comparison } from './calculations';
export async function getMetrics(db: D1Database, range: MetricRange): Promise<Metrics> {
  const data = await metricData(db, range),
    ids = data.packages.map((p) => p.id);
  let points = derivePoints(data.rows);
  if (range.channel !== 'all') {
    const groups = new Map<string, MetricPoint[]>();
    for (const p of points) {
      const key = p.packageId + '|' + p.observedAt;
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    points = [...groups.values()].map((group) => {
      const p = group[0]!;
      return {
        ...p,
        version: null,
        value: group.every((v) => v.value !== null)
          ? group.reduce((s, v) => s + (v.value ?? 0), 0)
          : null,
        growth: group.every((v) => v.growth !== null)
          ? group.reduce((s, v) => s + (v.growth ?? 0), 0)
          : null,
        quality: group.find((v) => v.quality !== 'ok')?.quality ?? 'ok',
        intervalStart: group.every((v) => v.intervalStart === p.intervalStart)
          ? p.intervalStart
          : null,
      };
    });
  }
  const duration = Date.parse(range.to) - Date.parse(range.from);
  const previousFrom = new Date(Date.parse(range.from) - duration).toISOString();
  const current = period(points, range.from, range.to, ids),
    previous = period(points, previousFrom, range.from, ids);
  const latest = ids.map((id) => points.filter((p) => p.packageId === id).at(-1));
  const valuesComplete =
    latest.length > 0 && latest.every((p) => p?.value !== null && p?.value !== undefined);
  const versions = await versionDistribution(db, ids, range.to, range.channel);
  return {
    latestTotal:
      valuesComplete && !data.truncated ? latest.reduce((s, p) => s + (p?.value ?? 0), 0) : null,
    growth: data.truncated ? null : current.growth,
    previousGrowth: data.truncated || !previous.complete ? null : previous.growth,
    comparison:
      data.truncated || !current.complete || !previous.complete
        ? null
        : comparison(current.growth, previous.growth),
    complete: current.complete && !data.truncated,
    trackingSince: data.packages.map((p) => p.created_at).sort()[0] ?? null,
    stale: data.packages.some(
      (p) => !p.last_success || Date.now() - Date.parse(p.last_success) > 7 * 3600000,
    ),
    points: points.filter((p) => p.observedAt >= range.from),
    versions,
    annotations: data.annotations,
    ...{ from: range.from, to: range.to },
    truncated: data.truncated,
  };
}
