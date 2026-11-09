import type { CollectionResult } from '../../providers/contracts';
export interface DueJob {
  package_id: string;
  provider: string;
  canonical_id: string;
  last_success: string | null;
  failures: number;
}
export async function dueJobs(db: D1Database, iso: string) {
  // Four leaves headroom for registry calls within Free-plan request/query budgets.
  return (
    await db
      .prepare(
        `SELECT j.*,p.provider,p.canonical_id,p.last_success FROM collection_jobs j JOIN packages p ON p.id=j.package_id
 WHERE p.archived=0 AND j.next_attempt<=? AND (j.lease_until IS NULL OR j.lease_until<?) ORDER BY j.next_attempt LIMIT 4`,
      )
      .bind(iso, iso)
      .all<DueJob>()
  ).results;
}
export async function claimJob(
  db: D1Database,
  id: string,
  token: string,
  iso: string,
  leaseUntil: string,
) {
  const claimed = await db
    .prepare(
      "UPDATE collection_jobs SET lease_token=?,lease_until=?,last_attempt=?,status='running' WHERE package_id=? AND next_attempt<=? AND (lease_until IS NULL OR lease_until<?)",
    )
    .bind(token, leaseUntil, iso, id, iso, iso)
    .run();
  if (!claimed.meta.changes) return false;
  await db.batch([
    db
      .prepare(
        "UPDATE sync_attempts SET status='interrupted',finished_at=?,error='LEASE_EXPIRED' WHERE package_id=? AND status='running'",
      )
      .bind(iso, id),
    db
      .prepare("INSERT INTO sync_attempts(id,package_id,started_at,status) VALUES(?,?,?,'running')")
      .bind(token, id, iso),
  ]);
  return true;
}
export async function commitCollection(
  db: D1Database,
  job: DueJob,
  token: string,
  iso: string,
  next: string,
  result: CollectionResult,
) {
  const guard = 'EXISTS(SELECT 1 FROM collection_jobs WHERE package_id=? AND lease_token=?)';
  const versions = JSON.stringify(
    result.metadata.versions.map((v) => ({ ...v, id: crypto.randomUUID() })),
  );
  const observations = JSON.stringify(result.observations);
  // JSON table-valued inserts keep query count independent of package version count.
  await db.batch([
    db
      .prepare(
        `INSERT INTO annotations(id,package_id,kind,title,body,occurred_at,automatic)
 SELECT json_extract(v.value,'$.id'),?,'release','Version '||json_extract(v.value,'$.version')||' discovered','First observed by SourceMetric; this is not the publication date.',?,1
 FROM json_each(?) v WHERE ? IS NOT NULL AND NOT EXISTS(SELECT 1 FROM package_versions pv WHERE pv.package_id=? AND pv.version=json_extract(v.value,'$.version')) AND ${guard}`,
      )
      .bind(job.package_id, iso, versions, job.last_success, job.package_id, job.package_id, token),
    db
      .prepare(
        `INSERT OR IGNORE INTO package_versions(package_id,version,prerelease,first_seen)
 SELECT ?,json_extract(value,'$.version'),json_extract(value,'$.prerelease'),? FROM json_each(?) WHERE ${guard}`,
      )
      .bind(job.package_id, iso, versions, job.package_id, token),
    db
      .prepare(
        `INSERT INTO observations(package_id,metric,scope,version,kind,value,observed_at,interval_start,interval_end,availability,quality,collection_id)
 SELECT ?,json_extract(value,'$.metric'),json_extract(value,'$.scope'),COALESCE(json_extract(value,'$.version'),''),json_extract(value,'$.kind'),
 json_extract(value,'$.value'),json_extract(value,'$.observedAt'),json_extract(value,'$.intervalStart'),json_extract(value,'$.intervalEnd'),
 json_extract(value,'$.availability'),json_extract(value,'$.quality'),?
 FROM json_each(?) WHERE ${guard} ON CONFLICT(package_id,metric,scope,version,collection_id) DO NOTHING`,
      )
      .bind(job.package_id, token, observations, job.package_id, token),
    db
      .prepare(
        `UPDATE packages SET description=?,latest_stable=?,latest_prerelease=?,last_success=? WHERE id=? AND ${guard}`,
      )
      .bind(
        result.metadata.description,
        result.metadata.latestStable,
        result.metadata.latestPrerelease,
        iso,
        job.package_id,
        job.package_id,
        token,
      ),
    db
      .prepare(`UPDATE sync_attempts SET status='success',finished_at=? WHERE id=? AND ${guard}`)
      .bind(iso, token, job.package_id, token),
    db
      .prepare(
        "UPDATE collection_jobs SET lease_token=NULL,lease_until=NULL,failures=0,last_error=NULL,status='success',next_attempt=? WHERE package_id=? AND lease_token=?",
      )
      .bind(next, job.package_id, token),
  ]);
}
export async function failCollection(
  db: D1Database,
  id: string,
  token: string,
  iso: string,
  next: string,
  code: string,
) {
  await db.batch([
    db
      .prepare("UPDATE sync_attempts SET status='failed',finished_at=?,error=? WHERE id=?")
      .bind(iso, code, token),
    db
      .prepare(
        "UPDATE collection_jobs SET lease_token=NULL,lease_until=NULL,failures=failures+1,last_error=?,status='failed',next_attempt=? WHERE package_id=? AND lease_token=?",
      )
      .bind(code, next, id, token),
  ]);
}
