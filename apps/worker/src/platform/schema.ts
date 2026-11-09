import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
export const projects = sqliteTable('projects', {
  id: text().primaryKey(),
  name: text().notNull(),
  archived: integer({ mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});
export const packages = sqliteTable(
  'packages',
  {
    id: text().primaryKey(),
    provider: text().notNull(),
    canonicalId: text('canonical_id').notNull(),
    displayName: text('display_name').notNull(),
    description: text().notNull().default(''),
    latestStable: text('latest_stable'),
    latestPrerelease: text('latest_prerelease'),
    archived: integer({ mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    lastSuccess: text('last_success'),
  },
  (t) => [uniqueIndex('package_identity').on(t.provider, t.canonicalId)],
);
export const projectPackages = sqliteTable(
  'project_packages',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    packageId: text('package_id')
      .notNull()
      .references(() => packages.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.packageId] })],
);
export const annotations = sqliteTable('annotations', {
  id: text().primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  packageId: text('package_id').references(() => packages.id, { onDelete: 'cascade' }),
  kind: text().notNull(),
  title: text().notNull(),
  body: text().notNull(),
  occurredAt: text('occurred_at').notNull(),
  automatic: integer({ mode: 'boolean' }).notNull().default(false),
});
