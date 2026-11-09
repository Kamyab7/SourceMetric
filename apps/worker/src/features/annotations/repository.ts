import { eq } from 'drizzle-orm';
import { database } from '../../platform/db';
import { annotations } from '../../platform/schema';
import type { z } from 'zod';
import { annotationInput } from '@sourcemetric/contracts';
export async function saveAnnotation(
  db: D1Database,
  input: z.infer<typeof annotationInput>,
  id?: string,
) {
  const row = {
    ...input,
    id: id ?? crypto.randomUUID(),
    projectId: input.projectId ?? null,
    packageId: input.packageId ?? null,
    automatic: false,
  };
  const query = database(db);
  return id
    ? (await query.update(annotations).set(row).where(eq(annotations.id, id)).returning())[0]
    : (await query.insert(annotations).values(row).returning())[0];
}
export async function deleteAnnotation(db: D1Database, id: string) {
  return database(db).delete(annotations).where(eq(annotations.id, id)).returning();
}
