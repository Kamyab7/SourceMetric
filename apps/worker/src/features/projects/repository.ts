import { eq, count } from 'drizzle-orm';
import { database } from '../../platform/db';
import { projects, projectPackages, packages } from '../../platform/schema';
export async function listProjects(binding: D1Database, limit: number, offset: number) {
  const db = database(binding);
  return {
    items: await db
      .select()
      .from(projects)
      .orderBy(projects.createdAt, projects.id)
      .limit(limit)
      .offset(offset),
    total: (await db.select({ value: count() }).from(projects))[0]?.value ?? 0,
  };
}
export async function createProject(binding: D1Database, name: string) {
  const row = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    archived: false,
  };
  await database(binding).insert(projects).values(row);
  return row;
}
export async function updateProject(
  binding: D1Database,
  id: string,
  patch: { name?: string; archived?: boolean },
) {
  return (
    await database(binding).update(projects).set(patch).where(eq(projects.id, id)).returning()
  )[0];
}
export async function associate(binding: D1Database, projectId: string, packageId: string) {
  const db = database(binding);
  const project = await db.select().from(projects).where(eq(projects.id, projectId));
  const pkg = await db.select().from(packages).where(eq(packages.id, packageId));
  if (!project.length || !pkg.length) return false;
  await db.insert(projectPackages).values({ projectId, packageId }).onConflictDoNothing();
  return true;
}
export async function dissociate(binding: D1Database, projectId: string, packageId: string) {
  await binding
    .prepare('DELETE FROM project_packages WHERE project_id=? AND package_id=?')
    .bind(projectId, packageId)
    .run();
}
