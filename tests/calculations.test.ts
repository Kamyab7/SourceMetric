import { describe, it, expect } from 'vitest';
import {
  derivePoints,
  period,
  comparison,
  type ObservationRow,
} from '../apps/worker/src/features/metrics/calculations';
import { csvCell } from '../apps/worker/src/features/exports/csv';
import { rangeSchema } from '@sourcemetric/contracts';
const row = (hour: number, value: number | null): ObservationRow => ({
  package_id: 'p',
  version: '',
  value,
  observed_at: new Date(Date.UTC(2026, 0, 1, hour)).toISOString(),
  kind: 'cumulative',
  interval_start: null,
  interval_end: null,
  availability: value === null ? 'unavailable' : 'available',
});
describe('measurement semantics', () => {
  it('establishes baselines and preserves gaps, unavailable counters, and corrections', () => {
    const points = derivePoints([
      row(0, 100),
      row(6, 130),
      row(12, null),
      row(24, 150),
      row(30, 80),
      row(36, 90),
    ]);
    expect(points.map((p) => p.growth)).toEqual([null, 30, null, 20, null, 10]);
    expect(points.map((p) => p.quality)).toEqual([
      'baseline',
      'ok',
      'unavailable',
      'gap',
      'correction',
      'ok',
    ]);
  });
  it('computes complete periods without treating missing periods as zero', () => {
    const points = derivePoints([row(0, 100), row(6, 120), row(12, 150)]);
    expect(period(points, row(0, 0).observed_at, row(12, 0).observed_at, ['p'])).toEqual({
      growth: 50,
      complete: true,
    });
    expect(period(points, row(0, 0).observed_at, row(24, 0).observed_at, ['p'])).toEqual({
      growth: 50,
      complete: false,
    });
    expect(comparison(20, 0)).toBeNull();
    expect(comparison(30, 20)).toBe(50);
  });
  it('does not infer version counters or interval boundaries', () => {
    const point = derivePoints([{ ...row(0, 20), kind: 'interval' }])[0];
    expect(point?.quality).toBe('unavailable');
  });
  it('escapes CSV formulas and quotes', () => {
    expect(csvCell(' =SUM(A1)')).toBe('"\' =SUM(A1)"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell(null)).toBe('""');
  });
  it('rejects inverted and excessive date ranges', () => {
    expect(
      rangeSchema.safeParse({ from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z' }).success,
    ).toBe(false);
  });
});
