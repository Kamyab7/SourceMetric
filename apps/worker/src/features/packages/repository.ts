import type { TrackedPackage } from '@sourcemetric/contracts';
import { bool } from '../../platform/db';
export function mapPackage(row: Record<string, unknown>): TrackedPackage {
  return {
    id: String(row.id),
    provider: 'nuget',
    canonicalId: String(row.canonical_id),
    displayName: String(row.display_name),
    description: String(row.description),
    latestStable: row.latest_stable as string | null,
    latestPrerelease: row.latest_prerelease as string | null,
    archived: bool(row.archived),
    createdAt: String(row.created_at),
    lastSuccess: row.last_success as string | null,
    lastAttempt: row.last_attempt as string | null,
    nextAttempt: String(row.next_attempt),
    lastError: row.last_error as string | null,
    status: String(row.status),
    observationCount: Number(row.observation_count),
  };
}
const select = `SELECT p.*,j.last_attempt,j.next_attempt,j.last_error,j.status,
 (SELECT COUNT(*) FROM observations o WHERE o.package_id=p.id) observation_count
 FROM packages p JOIN collection_jobs j ON j.package_id=p.id`;
export async function listPackages(db: D1Database, limit = 100, offset = 0, projectId?: string) {
  const where = projectId
    ? ' WHERE EXISTS (SELECT 1 FROM project_packages a WHERE a.package_id=p.id AND a.project_id=?)'
    : '';
  const params = projectId ? [projectId] : [];
  const [rows, total] = await Promise.all([
    db
      .prepare(select + where + ' ORDER BY p.display_name,p.id LIMIT ? OFFSET ?')
      .bind(...params, limit, offset)
      .all<Record<string, unknown>>(),
    db
      .prepare('SELECT COUNT(*) n FROM packages p' + where)
      .bind(...params)
      .first<{ n: number }>(),
  ]);
  return { items: rows.results.map(mapPackage), total: total?.n ?? 0 };
}
export async function getPackage(db: D1Database, id: string) {
  const row = await db
    .prepare(select + ' WHERE p.id=?')
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? mapPackage(row) : null;
}
