import {
  GitHubProvider,
  type RepositoryProvider,
  type RepositoryCollection,
} from '../../providers/github/provider';
import { AppError } from '../../platform/errors';
export interface RepositoryJob {
  repository_id: string;
  github_id: string;
  failures: number;
}
export async function claimRepository(db: D1Database, id: string, token: string, iso: string) {
  const guard = 'EXISTS(SELECT 1 FROM repository_jobs WHERE repository_id=? AND lease_token=?)';
  // Claim and attempt bookkeeping share a transaction; every attempt write is fenced.
  const results = await db.batch([
    db
      .prepare(
        `UPDATE repository_jobs SET lease_token=?,lease_until=?,last_attempt=?,status='running'
      WHERE repository_id=? AND next_attempt<=? AND (lease_until IS NULL OR lease_until<?)
      AND EXISTS(SELECT 1 FROM repositories WHERE id=? AND archived=0)`,
      )
      .bind(token, new Date(Date.parse(iso) + 300000).toISOString(), iso, id, iso, iso, id),
    db
      .prepare(
        `UPDATE repository_attempts SET status='interrupted',finished_at=?,error='LEASE_EXPIRED' WHERE repository_id=? AND status='running' AND ${guard}`,
      )
      .bind(iso, id, id, token),
    db
      .prepare(
        `INSERT INTO repository_attempts(id,repository_id,started_at,status) SELECT ?,?,?,'running' WHERE ${guard}`,
      )
      .bind(token, id, iso, id, token),
  ]);
  return !!results[0]!.meta.changes;
}
export async function commitRepository(
  db: D1Database,
  job: RepositoryJob,
  token: string,
  iso: string,
  next: string,
  result: RepositoryCollection,
) {
  const id = job.repository_id,
    m = result.metadata;
  if (m.githubId !== job.github_id)
    throw new AppError(
      502,
      'GITHUB_IDENTITY_CHANGED',
      'GitHub returned a different repository identity.',
    );
  const guard = 'EXISTS(SELECT 1 FROM repository_jobs WHERE repository_id=? AND lease_token=?)';
  const trafficError = result.traffic.error;
  await db.batch([
    db
      .prepare(
        `INSERT INTO repository_snapshots(repository_id,observed_at,stars,forks) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT DO NOTHING`,
      )
      .bind(id, iso, m.stars, m.forks, id, token),
    db
      .prepare(
        `INSERT INTO repository_clones(repository_id,day,count,uniques,observed_at,provisional)
      SELECT ?,json_extract(value,'$.day'),json_extract(value,'$.count'),json_extract(value,'$.uniques'),?,CASE WHEN json_extract(value,'$.day')>=? THEN 1 ELSE 0 END
      FROM json_each(?) WHERE ${guard}
      ON CONFLICT(repository_id,day) DO UPDATE SET count=excluded.count,uniques=excluded.uniques,observed_at=excluded.observed_at,provisional=excluded.provisional
      WHERE excluded.observed_at>=repository_clones.observed_at`,
      )
      .bind(
        id,
        iso,
        iso.slice(0, 10) + 'T00:00:00.000Z',
        JSON.stringify(result.traffic.days ?? []),
        id,
        token,
      ),
    db
      .prepare(
        `UPDATE repositories SET full_name=?,url=?,description=?,private=?,last_success=?,traffic_error=?,traffic_success=CASE WHEN ? IS NULL THEN ? ELSE traffic_success END WHERE id=? AND ${guard}`,
      )
      .bind(
        m.fullName,
        m.url,
        m.description,
        m.private ? 1 : 0,
        iso,
        trafficError,
        trafficError,
        iso,
        id,
        id,
        token,
      ),
    db
      .prepare(
        `UPDATE repository_attempts SET status=?,finished_at=?,error=? WHERE id=? AND ${guard}`,
      )
      .bind(trafficError ? 'partial' : 'success', iso, trafficError, token, id, token),
    db
      .prepare(
        `UPDATE repository_jobs SET lease_token=NULL,lease_until=NULL,failures=?,last_error=?,status=?,next_attempt=? WHERE repository_id=? AND lease_token=?`,
      )
      .bind(
        trafficError ? job.failures + 1 : 0,
        trafficError,
        trafficError ? 'partial' : 'success',
        next,
        id,
        token,
      ),
  ]);
}
export async function failRepository(
  db: D1Database,
  id: string,
  token: string,
  iso: string,
  next: string,
  code: string,
) {
  await db.batch([
    db
      .prepare(
        `UPDATE repository_attempts SET status='failed',finished_at=?,error=? WHERE id=? AND EXISTS(SELECT 1 FROM repository_jobs WHERE repository_id=? AND lease_token=?)`,
      )
      .bind(iso, code, token, id, token),
    db
      .prepare(
        `UPDATE repository_jobs SET lease_token=NULL,lease_until=NULL,failures=failures+1,last_error=?,status='failed',next_attempt=? WHERE repository_id=? AND lease_token=?`,
      )
      .bind(code, next, id, token),
  ]);
}
export async function collectRepositories(
  db: D1Database,
  options: { now?: Date; provider?: RepositoryProvider; token?: string } = {},
) {
  const now = options.now ?? new Date(),
    iso = now.toISOString();
  const jobs = (
    await db
      .prepare(
        `SELECT j.repository_id,j.failures,r.github_id FROM repository_jobs j JOIN repositories r ON r.id=j.repository_id
    WHERE r.archived=0 AND j.next_attempt<=? AND (j.lease_until IS NULL OR j.lease_until<?) ORDER BY j.next_attempt,j.repository_id LIMIT 4`,
      )
      .bind(iso, iso)
      .all<RepositoryJob>()
  ).results;
  const provider = options.provider ?? new GitHubProvider(options.token);
  let cursor = 0,
    successes = 0,
    failures = 0,
    partial = 0;
  const delay = (failures: number, retry = 0) =>
    Math.max(Math.min(2 ** Math.min(failures, 8) * 3600000, 86400000), retry);
  const work = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      if (!job) continue;
      const token = crypto.randomUUID();
      if (!(await claimRepository(db, job.repository_id, token, iso))) continue;
      try {
        const result = await provider.collect(job.github_id);
        const retry = result.traffic.days === null ? result.traffic.retryAfter : 0;
        const next = new Date(
          now.getTime() +
            (result.traffic.error
              ? Math.max(6 * 3600000, delay(job.failures, retry))
              : 6 * 3600000),
        ).toISOString();
        await commitRepository(db, job, token, iso, next, result);
        if (result.traffic.error) partial++;
        else successes++;
      } catch (error) {
        const code = error instanceof AppError ? error.code : 'COLLECTION_FAILED';
        await failRepository(
          db,
          job.repository_id,
          token,
          iso,
          new Date(
            now.getTime() + delay(job.failures, error instanceof AppError ? error.retryAfter : 0),
          ).toISOString(),
          code,
        );
        failures++;
      }
    }
  };
  await Promise.all([work(), work()]);
  const report = {
    event: 'repository_collection_completed',
    repositories: jobs.length,
    successes,
    partial,
    failures,
  };
  console.log(JSON.stringify(report));
  return report;
}
