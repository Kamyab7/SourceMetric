import type { MetricPoint } from '@sourcemetric/contracts';
export interface ObservationRow {
  package_id: string;
  version: string;
  value: number | null;
  observed_at: string;
  kind: 'cumulative' | 'interval';
  interval_start: string | null;
  interval_end: string | null;
  availability: string;
}
export function derivePoints(rows: ObservationRow[]): MetricPoint[] {
  const previous = new Map<string, ObservationRow>();
  return rows.map((row) => {
    const key = row.package_id + '|' + row.version,
      prev = previous.get(key);
    const point: MetricPoint = {
      packageId: row.package_id,
      version: row.version || null,
      observedAt: row.observed_at,
      intervalStart: null,
      value: row.value,
      growth: null,
      quality: 'unavailable',
    };
    if (row.value === null || row.availability !== 'available') return point;
    if (row.kind === 'interval') {
      point.intervalStart = row.interval_start;
      point.growth = row.value;
      point.quality = row.interval_start && row.interval_end ? 'ok' : 'unavailable';
      return point;
    }
    if (prev) {
      point.intervalStart = prev.observed_at;
      point.quality =
        row.value < (prev.value ?? 0)
          ? 'correction'
          : Date.parse(row.observed_at) - Date.parse(prev.observed_at) > 7 * 3600000
            ? 'gap'
            : 'ok';
      if (point.quality !== 'correction') point.growth = row.value - (prev.value ?? 0);
    } else point.quality = 'baseline';
    previous.set(key, row);
    return point;
  });
}
export function period(points: MetricPoint[], from: string, to: string, expectedIds: string[]) {
  const start = Date.parse(from),
    end = Date.parse(to);
  let sum = 0,
    measured = 0,
    complete = expectedIds.length > 0;
  for (const id of expectedIds) {
    const series = points.filter((p) => p.packageId === id);
    const selected = series.filter(
      (p) => Date.parse(p.observedAt) > start && Date.parse(p.observedAt) <= end,
    );
    const before = series.some((p) => p.value !== null && Date.parse(p.observedAt) <= start);
    const latest = selected.at(-1);
    // A six-hour sampling tolerance does not imply exact daily attribution.
    if (
      !before ||
      !latest ||
      end - Date.parse(latest.observedAt) > 7 * 3600000 ||
      selected.some(
        (p) =>
          p.growth === null ||
          p.quality !== 'ok' ||
          !p.intervalStart ||
          Date.parse(p.intervalStart) < start,
      )
    )
      complete = false;
    for (const p of selected)
      if (p.growth !== null && p.intervalStart && Date.parse(p.intervalStart) >= start) {
        sum += p.growth;
        measured++;
      }
  }
  return { growth: measured ? sum : null, complete };
}
export function comparison(current: number | null, previous: number | null) {
  return current === null || previous === null || previous === 0
    ? null
    : ((current - previous) / previous) * 100;
}
