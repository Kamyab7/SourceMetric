import type { TrackedRepository } from '@sourcemetric/contracts';
import type { RepositoryMetadata } from '../../providers/github/provider';
import { AppError, notFound } from '../../platform/errors';
const select = `SELECT r.*,j.last_attempt,j.next_attempt,j.last_error,j.status FROM repositories r JOIN repository_jobs j ON j.repository_id=r.id`;
export function mapRepository(r: Record<string, unknown>): TrackedRepository {
  return {
    id: String(r.id),
    provider: 'github',
    githubId: String(r.github_id),
    fullName: String(r.full_name),
    url: String(r.url),
    description: String(r.description),
    private: !!r.private,
    archived: !!r.archived,
    createdAt: String(r.created_at),
    lastSuccess: r.last_success as string | null,
    trafficSuccess: r.traffic_success as string | null,
    trafficError: r.traffic_error as string | null,
    lastAttempt: r.last_attempt as string | null,
    nextAttempt: String(r.next_attempt),
    lastError: r.last_error as string | null,
    status: String(r.status),
  };
}
export async function getRepository(db: D1Database, id: string) {
  const row = await db
    .prepare(select + ' WHERE r.id=?')
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? mapRepository(row) : null;
}
export function repositoryScope(projectId?: string, repositoryId?: string) {
  const params: string[] = [],
    conditions: string[] = [];
  if (projectId) {
    conditions.push(
      'EXISTS(SELECT 1 FROM project_repositories a WHERE a.repository_id=r.id AND a.project_id=?)',
    );
    params.push(projectId);
  }
  if (repositoryId) {
    conditions.push('r.id=?');
    params.push(repositoryId);
  }
  return { where: conditions.length ? ' WHERE ' + conditions.join(' AND ') : '', params };
}
export async function listRepositories(
  db: D1Database,
  limit = 100,
  offset = 0,
  projectId?: string,
) {
  const { where, params } = repositoryScope(projectId);
  const [rows, total] = await Promise.all([
    db
      .prepare(select + where + ' ORDER BY r.full_name,r.id LIMIT ? OFFSET ?')
      .bind(...params, limit, offset)
      .all<Record<string, unknown>>(),
    db
      .prepare('SELECT COUNT(*) n FROM repositories r' + where)
      .bind(...params)
      .first<{ n: number }>(),
  ]);
  return { items: rows.results.map(mapRepository), total: total?.n ?? 0 };
}
export async function associateRepository(db: D1Database, projectId: string, repositoryId: string) {
  if (
    !(await db.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first()) ||
    !(await getRepository(db, repositoryId))
  )
    throw notFound();
  await db
    .prepare('INSERT OR IGNORE INTO project_repositories(project_id,repository_id) VALUES(?,?)')
    .bind(projectId, repositoryId)
    .run();
}
export async function registerRepository(
  db: D1Database,
  metadata: RepositoryMetadata,
  projectId?: string,
) {
  if (
    projectId &&
    !(await db.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first())
  )
    throw notFound();
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  const statements = [
    db
      .prepare(
        `INSERT INTO repositories(id,github_id,full_name,url,description,private,created_at)
    SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM repositories WHERE archived=0)<20 OR EXISTS(SELECT 1 FROM repositories WHERE github_id=?)
    ON CONFLICT(github_id) DO UPDATE SET full_name=excluded.full_name,url=excluded.url,description=excluded.description,private=excluded.private`,
      )
      .bind(
        id,
        metadata.githubId,
        metadata.fullName,
        metadata.url,
        metadata.description,
        metadata.private ? 1 : 0,
        now,
        metadata.githubId,
      ),
    db
      .prepare(
        'INSERT OR IGNORE INTO repository_jobs(repository_id,next_attempt) SELECT id,? FROM repositories WHERE github_id=?',
      )
      .bind(now, metadata.githubId),
  ];
  if (projectId)
    statements.push(
      db
        .prepare(
          'INSERT OR IGNORE INTO project_repositories(project_id,repository_id) SELECT ?,id FROM repositories WHERE github_id=?',
        )
        .bind(projectId, metadata.githubId),
    );
  await db.batch(statements);
  const row = await db
    .prepare('SELECT id FROM repositories WHERE github_id=?')
    .bind(metadata.githubId)
    .first<{ id: string }>();
  if (!row)
    throw new AppError(
      409,
      'CAPACITY_REACHED',
      'Archive a repository first. This deployment supports 20 active repositories.',
    );
  return getRepository(db, row.id);
}
