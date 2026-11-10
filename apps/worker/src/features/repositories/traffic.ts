import { Hono } from 'hono';
import {
  idSchema,
  paginationSchema,
  repositoryRangeSchema,
  trafficMetricSchema,
  trafficSnapshotSchema,
  trafficDetailSchema,
  trafficStatusSchema,
} from '@sourcemetric/contracts';
import type { z } from 'zod';
import { parse, type AppBindings } from '../../platform/http';
import { AppError, notFound } from '../../platform/errors';
import { repositoryScope } from './repository';
import { csvRow } from '../exports/csv';
const columns = `s.id,s.repository_id repositoryId,s.metric,s.observed_at observedAt,s.window_days windowDays,s.count,s.uniques,json_array_length(s.items) itemCount`;
type Summary = z.infer<typeof trafficSnapshotSchema>;
export async function trafficStatuses(db: D1Database, ids: string[]) {
  if (!ids.length) return [];
  return (
    await db
      .prepare(
        `SELECT repository_id repositoryId,metric,last_attempt lastAttempt,last_success lastSuccess,status,error FROM repository_traffic_status WHERE repository_id IN (SELECT value FROM json_each(?)) ORDER BY repository_id,metric`,
      )
      .bind(JSON.stringify(ids))
      .all<z.infer<typeof trafficStatusSchema>>()
  ).results;
}
export const repositoryTrafficRoutes = new Hono<AppBindings>()
  .get('/', async (c) => {
    const range = parse(repositoryRangeSchema, c.req.query()),
      page = parse(paginationSchema, c.req.query());
    // Pagination is by repository, keeping all three endpoint summaries in each group.
    const { where, params } = repositoryScope(range.projectId, range.repositoryId);
    const selected = (
      await c.env.DB.prepare(
        `SELECT r.id,r.full_name fullName FROM repositories r${where} ORDER BY r.full_name,r.id LIMIT ? OFFSET ?`,
      )
        .bind(...params, page.limit, page.offset)
        .all<{ id: string; fullName: string }>()
    ).results;
    const total = await c.env.DB.prepare('SELECT COUNT(*) n FROM repositories r' + where)
      .bind(...params)
      .first<{ n: number }>();
    const ids = selected.map((r) => r.id);
    const [snapshots, statuses] = await Promise.all([
      c.env.DB.prepare(
        `SELECT ${columns} FROM json_each(?) selected CROSS JOIN json_each('["views","paths","referrers"]') metrics
        JOIN repository_traffic_snapshots s ON s.id=(SELECT b.id FROM repository_traffic_snapshots b WHERE b.repository_id=selected.value AND b.metric=metrics.value AND b.observed_at<=? ORDER BY b.observed_at DESC LIMIT 1) ORDER BY s.repository_id,s.metric`,
      )
        .bind(JSON.stringify(ids), range.to)
        .all<Summary>(),
      trafficStatuses(c.env.DB, ids),
    ]);
    return c.json({
      items: selected.map((r) => ({
        repositoryId: r.id,
        repositoryName: r.fullName,
        snapshots: snapshots.results.filter((s) => s.repositoryId === r.id),
        statuses: statuses.filter((s) => s.repositoryId === r.id),
      })),
      total: total?.n ?? 0,
    });
  })
  .get('/history', async (c) => {
    const id = parse(idSchema, c.req.query('repositoryId')),
      metric = parse(trafficMetricSchema, c.req.query('metric'));
    const range = parse(repositoryRangeSchema, c.req.query()),
      p = parse(paginationSchema, c.req.query());
    // History intentionally includes older snapshots up to the as-of date, including stale ones.
    const [rows, total] = await Promise.all([
      c.env.DB.prepare(
        `SELECT ${columns} FROM repository_traffic_snapshots s WHERE s.repository_id=? AND s.metric=? AND s.observed_at<=? ORDER BY s.observed_at DESC,s.id DESC LIMIT ? OFFSET ?`,
      )
        .bind(id, metric, range.to, p.limit, p.offset)
        .all<Summary>(),
      c.env.DB.prepare(
        'SELECT COUNT(*) n FROM repository_traffic_snapshots WHERE repository_id=? AND metric=? AND observed_at<=?',
      )
        .bind(id, metric, range.to)
        .first<{ n: number }>(),
    ]);
    return c.json({ items: rows.results, total: total?.n ?? 0 });
  })
  .get('/snapshots/:id', async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT ${columns},s.items FROM repository_traffic_snapshots s WHERE s.id=?`,
    )
      .bind(parse(idSchema, c.req.param('id')))
      .first<Summary & { items: string }>();
    if (!row) throw notFound();
    return c.json(trafficDetailSchema.parse({ ...row, items: JSON.parse(row.items) }));
  });
export const repositoryTrafficExportRoutes = new Hono<AppBindings>().get('/', async (c) => {
  const range = parse(repositoryRangeSchema, c.req.query()),
    metric = c.req.query('metric');
  const { where, params } = repositoryScope(range.projectId, range.repositoryId);
  const metricFilter = metric ? ' AND s.metric=?' : '';
  // Reject oversized payloads before materializing potentially large JSON arrays in Worker memory.
  const budget = await c.env.DB.prepare(
    `SELECT COUNT(*) snapshots,COALESCE(SUM(MAX(1,json_array_length(s.items))),0) rows,
    COALESCE(SUM(length(CAST(s.items AS BLOB))*2+MAX(1,json_array_length(s.items))*(1024+length(CAST(r.full_name AS BLOB)))),0) bytes
    FROM repository_traffic_snapshots s JOIN repositories r ON r.id=s.repository_id
    WHERE s.repository_id IN (SELECT r.id FROM repositories r${where}) AND s.observed_at>=? AND s.observed_at<=?${metricFilter}`,
  )
    .bind(...params, range.from, range.to, ...(metric ? [parse(trafficMetricSchema, metric)] : []))
    .first<{ snapshots: number; rows: number; bytes: number }>();
  if (budget && (budget.snapshots > 50000 || budget.rows > 50000 || budget.bytes > 8 * 1024 * 1024))
    throw new AppError(
      400,
      'RANGE_TOO_LARGE',
      'Choose a smaller range to export traffic snapshots.',
    );
  const rows = (
    await c.env.DB.prepare(
      `SELECT ${columns},s.items,r.full_name repositoryName FROM repository_traffic_snapshots s JOIN repositories r ON r.id=s.repository_id
    WHERE s.repository_id IN (SELECT r.id FROM repositories r${where}) AND s.observed_at>=? AND s.observed_at<=?${metricFilter} ORDER BY s.repository_id,s.observed_at,s.metric LIMIT 50001`,
    )
      .bind(
        ...params,
        range.from,
        range.to,
        ...(metric ? [parse(trafficMetricSchema, metric)] : []),
      )
      .all<Summary & { items: string; repositoryName: string }>()
  ).results;
  if (rows.length > 50000 || rows.reduce((sum, r) => sum + Math.max(1, r.itemCount), 0) > 50000)
    throw new AppError(
      400,
      'RANGE_TOO_LARGE',
      'Choose a smaller range to export traffic snapshots.',
    );
  const content = [
    csvRow([
      'snapshot_id',
      'repository_id',
      'repository_name',
      'metric',
      'source',
      'observed_at_utc',
      'window',
      'window_days',
      'rank',
      'item',
      'title',
      'count',
      'uniques',
      'quality',
    ]),
  ];
  for (const row of rows) {
    const detail = trafficDetailSchema.parse({ ...row, items: JSON.parse(row.items) });
    const items = detail.items.length
      ? detail.items
      : [{ identity: null, title: null, count: detail.count, uniques: detail.uniques }];
    items.forEach((item, i) =>
      content.push(
        csvRow([
          row.id,
          row.repositoryId,
          row.repositoryName,
          row.metric,
          'github',
          row.observedAt,
          'rolling',
          14,
          detail.items.length ? i + 1 : null,
          item.identity,
          item.title,
          item.count,
          item.uniques,
          row.metric !== 'views' && !detail.items.length ? 'empty_snapshot' : 'snapshot',
        ]),
      ),
    );
  }
  return new Response(content.join(''), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sourcemetric-traffic-snapshots.csv"',
    },
  });
});
