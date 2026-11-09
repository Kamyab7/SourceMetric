import { Hono } from 'hono';
import { rangeSchema } from '@sourcemetric/contracts';
import { parse, type AppBindings } from '../../platform/http';
import { metricData } from '../metrics/repository';
import { derivePoints } from '../metrics/calculations';
import { csvRow } from './csv';
import { AppError } from '../../platform/errors';
export const exportRoutes = new Hono<AppBindings>().get('/', async (c) => {
  const range = parse(rangeSchema, c.req.query()),
    data = await metricData(c.env.DB, range, true);
  if (data.truncated)
    throw new AppError(
      400,
      'RANGE_TOO_LARGE',
      'Choose a smaller date range to export all observations.',
    );
  const points = derivePoints(data.rows).filter((p) => p.observedAt >= range.from);
  const content =
    csvRow([
      'package_id',
      'version',
      'observed_at_utc',
      'interval_start_utc',
      'counter_value',
      'observed_growth',
      'quality',
    ]) +
    points
      .map((p) =>
        csvRow([
          p.packageId,
          p.version,
          p.observedAt,
          p.intervalStart,
          p.value,
          p.growth,
          p.quality,
        ]),
      )
      .join('');
  return new Response(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sourcemetric-observations.csv"',
    },
  });
});
