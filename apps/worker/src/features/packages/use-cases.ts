import { createPackageProvider } from '../../providers/factory';
import { AppError, notFound } from '../../platform/errors';
import { getPackage } from './repository';
import type { z } from 'zod';
import { packageInput } from '@sourcemetric/contracts';
export async function registerPackage(db: D1Database, input: z.infer<typeof packageInput>) {
  if (
    input.projectId &&
    !(await db.prepare('SELECT id FROM projects WHERE id=?').bind(input.projectId).first())
  )
    throw notFound();
  const metadata = await createPackageProvider(input.provider).resolve(input.packageId);
  const existing = await db
    .prepare('SELECT id FROM packages WHERE provider=? AND canonical_id=?')
    .bind(input.provider, metadata.canonicalId)
    .first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID(),
    now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (!existing) {
    // The INSERT SELECT enforces the capacity limit even for concurrent registrations.
    statements.push(
      db
        .prepare(
          `INSERT INTO packages(id,provider,canonical_id,display_name,description,latest_stable,latest_prerelease,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM packages WHERE archived=0)<20
    ON CONFLICT(provider,canonical_id) DO NOTHING`,
        )
        .bind(
          id,
          input.provider,
          metadata.canonicalId,
          metadata.displayName,
          metadata.description,
          metadata.latestStable,
          metadata.latestPrerelease,
          now,
        ),
    );
    statements.push(
      db
        .prepare(
          'INSERT OR IGNORE INTO collection_jobs(package_id,next_attempt) SELECT id,? FROM packages WHERE id=?',
        )
        .bind(now, id),
    );
  }
  if (input.projectId)
    statements.push(
      db
        .prepare(
          'INSERT OR IGNORE INTO project_packages(project_id,package_id) SELECT ?,id FROM packages WHERE provider=? AND canonical_id=?',
        )
        .bind(input.projectId, input.provider, metadata.canonicalId),
    );
  if (statements.length) await db.batch(statements);
  const row = await db
    .prepare('SELECT id FROM packages WHERE provider=? AND canonical_id=?')
    .bind(input.provider, metadata.canonicalId)
    .first<{ id: string }>();
  if (!row)
    throw new AppError(
      409,
      'CAPACITY_REACHED',
      'The deployment supports up to 20 active packages. Archive a package first.',
    );
  return getPackage(db, row.id);
}
