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

export const repositories = sqliteTable('repositories', {
  id: text().primaryKey(),
  provider: text().notNull().default('github'),
  githubId: text('github_id').notNull().unique(),
  fullName: text('full_name').notNull(),
  url: text().notNull(),
  description: text().notNull().default(''),
  private: integer({ mode: 'boolean' }).notNull().default(false),
  archived: integer({ mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  lastSuccess: text('last_success'),
  trafficSuccess: text('traffic_success'),
  trafficError: text('traffic_error'),
});
export const projectRepositories = sqliteTable(
  'project_repositories',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.repositoryId] }),
    index('repository_associations').on(t.repositoryId),
  ],
);
export const repositoryJobs = sqliteTable(
  'repository_jobs',
  {
    repositoryId: text('repository_id')
      .primaryKey()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    nextAttempt: text('next_attempt').notNull(),
    leaseToken: text('lease_token'),
    leaseUntil: text('lease_until'),
    failures: integer().notNull().default(0),
    lastAttempt: text('last_attempt'),
    lastError: text('last_error'),
    manualRequestedAt: text('manual_requested_at'),
    status: text().notNull().default('queued'),
  },
  (t) => [index('repository_due').on(t.nextAttempt, t.leaseUntil)],
);
export const repositoryAttempts = sqliteTable(
  'repository_attempts',
  {
    id: text().primaryKey(),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    status: text().notNull(),
    error: text(),
  },
  (t) => [index('repository_attempt_time').on(t.startedAt, t.id)],
);
export const repositorySnapshots = sqliteTable(
  'repository_snapshots',
  {
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    observedAt: text('observed_at').notNull(),
    stars: integer().notNull(),
    forks: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.observedAt] })],
);
export const repositoryClones = sqliteTable(
  'repository_clones',
  {
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    day: text().notNull(),
    count: integer().notNull(),
    uniques: integer().notNull(),
    observedAt: text('observed_at').notNull(),
    provisional: integer({ mode: 'boolean' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.day] })],
);
