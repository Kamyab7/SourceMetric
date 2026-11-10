import { z } from 'zod';

export const providerIdSchema = z.literal('nuget');
export const idSchema = z.string().uuid();
export const nameSchema = z.string().trim().min(1).max(120);
export const projectInput = z.object({ name: nameSchema });
export const projectPatch = z.object({
  name: nameSchema.optional(),
  archived: z.boolean().optional(),
});
export const packageInput = z.object({
  provider: providerIdSchema.default('nuget'),
  packageId: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_.-]{1,100}$/),
  projectId: idSchema.optional(),
});
export const packagePatch = z.object({ archived: z.boolean() });
export const annotationInput = z
  .object({
    projectId: idSchema.optional(),
    packageId: idSchema.optional(),
    kind: z.enum(['release', 'campaign']),
    title: nameSchema,
    body: z.string().max(2000).default(''),
    occurredAt: z.iso.datetime().transform((v) => new Date(v).toISOString()),
  })
  .refine(
    (v) => Boolean(v.projectId) !== Boolean(v.packageId),
    'Choose exactly one project or package',
  );
export const rangeSchema = z
  .object({
    from: z.iso.datetime().transform((v) => new Date(v).toISOString()),
    to: z.iso.datetime().transform((v) => new Date(v).toISOString()),
    projectId: idSchema.optional(),
    packageId: idSchema.optional(),
    channel: z.enum(['all', 'stable', 'prerelease']).default('all'),
  })
  .refine((v) => Date.parse(v.from) < Date.parse(v.to), 'from must precede to')
  .refine(
    (v) => Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
    'Maximum range is 366 days',
  );
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 100)
    .default(0),
});
export type MetricRange = z.infer<typeof rangeSchema>;
export const projectSchema = z.object({
  id: idSchema,
  name: z.string(),
  archived: z.boolean(),
  createdAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;
export const packageSchema = z.object({
  id: idSchema,
  provider: providerIdSchema,
  canonicalId: z.string(),
  displayName: z.string(),
  description: z.string(),
  latestStable: z.string().nullable(),
  latestPrerelease: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.string(),
  lastSuccess: z.string().nullable(),
  lastAttempt: z.string().nullable(),
  nextAttempt: z.string(),
  lastError: z.string().nullable(),
  status: z.string(),
  observationCount: z.number(),
});
export type TrackedPackage = z.infer<typeof packageSchema>;
export const annotationSchema = z.object({
  id: idSchema,
  projectId: idSchema.nullable(),
  packageId: idSchema.nullable(),
  kind: z.enum(['release', 'campaign']),
  title: z.string(),
  body: z.string(),
  occurredAt: z.string(),
  automatic: z.boolean(),
});
export type Annotation = z.infer<typeof annotationSchema>;
export const pointSchema = z.object({
  packageId: z.string(),
  version: z.string().nullable(),
  observedAt: z.string(),
  intervalStart: z.string().nullable(),
  value: z.number().nullable(),
  growth: z.number().nullable(),
  quality: z.enum(['baseline', 'ok', 'gap', 'correction', 'unavailable']),
});
export type MetricPoint = z.infer<typeof pointSchema>;
export const metricsSchema = z.object({
  latestTotal: z.number().nullable(),
  growth: z.number().nullable(),
  previousGrowth: z.number().nullable(),
  comparison: z.number().nullable(),
  complete: z.boolean(),
  trackingSince: z.string().nullable(),
  stale: z.boolean(),
  points: z.array(pointSchema),
  versions: z.array(
    z.object({
      packageId: z.string(),
      version: z.string(),
      downloads: z.number(),
      observedAt: z.string(),
    }),
  ),
  annotations: z.array(annotationSchema),
  from: z.string(),
  to: z.string(),
  truncated: z.boolean(),
});
export type Metrics = z.infer<typeof metricsSchema>;
export const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export function listSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), total: z.number() });
}
export const syncSchema = z.object({
  packages: z.array(packageSchema),
  observationCount: z.number(),
  packageTotal: z.number(),
  attemptTotal: z.number(),
  attempts: z.array(
    z.object({
      id: z.string(),
      packageId: z.string(),
      packageName: z.string(),
      startedAt: z.string(),
      finishedAt: z.string().nullable(),
      status: z.string(),
      error: z.string().nullable(),
    }),
  ),
});

export const healthSchema = z.object({ ok: z.boolean(), demo: z.boolean() });

export const versionSchema = z.object({
  packageId: z.string(),
  version: z.string(),
  downloads: z.number(),
  observedAt: z.string(),
});

// Repository metrics are independent of package/download providers.
export const repositoryInput = z.object({
  repository: z.string().trim().min(3).max(240),
  projectId: idSchema.optional(),
});
export const repositoryMetadataSchema = z.object({
  githubId: z.string(),
  fullName: z.string(),
  url: z.url(),
  description: z.string(),
  private: z.boolean(),
  stars: z.number().int().nonnegative(),
  forks: z.number().int().nonnegative(),
});
export const repositorySchema = repositoryMetadataSchema.omit({ stars: true, forks: true }).extend({
  id: idSchema,
  provider: z.literal('github'),
  archived: z.boolean(),
  createdAt: z.string(),
  lastSuccess: z.string().nullable(),
  trafficSuccess: z.string().nullable(),
  trafficError: z.string().nullable(),
  lastAttempt: z.string().nullable(),
  nextAttempt: z.string(),
  lastError: z.string().nullable(),
  status: z.string(),
});
export type TrackedRepository = z.infer<typeof repositorySchema>;
export const repositoryRangeSchema = z
  .object({
    from: z.iso.datetime().transform((v) => new Date(v).toISOString()),
    to: z.iso.datetime().transform((v) => new Date(v).toISOString()),
    projectId: idSchema.optional(),
    repositoryId: idSchema.optional(),
  })
  .refine((v) => Date.parse(v.from) < Date.parse(v.to), 'from must precede to')
  .refine(
    (v) => Date.parse(v.to) - Date.parse(v.from) <= 366 * 86400000,
    'Maximum range is 366 days',
  );
export type RepositoryRange = z.infer<typeof repositoryRangeSchema>;
export const repositorySnapshotSchema = z.object({
  repositoryId: idSchema,
  observedAt: z.string(),
  stars: z.number(),
  forks: z.number(),
});
export const repositoryCloneSchema = z.object({
  repositoryId: idSchema,
  day: z.string(),
  count: z.number(),
  uniques: z.number(),
  observedAt: z.string(),
  provisional: z.boolean(),
});
const repositoryGaugeSchema = z.object({
  latest: z.number().nullable(),
  change: z.number().nullable(),
  comparison: z.number().nullable(),
  complete: z.boolean(),
});
export const repositoryMetricsSchema = z.object({
  from: z.string(),
  to: z.string(),
  repositories: z.array(repositorySchema),
  stars: repositoryGaugeSchema,
  forks: repositoryGaugeSchema,
  clones: z.object({
    total: z.number().nullable(),
    complete: z.boolean(),
    comparison: z.number().nullable(),
  }),
  snapshots: z.array(repositorySnapshotSchema),
  days: z.array(repositoryCloneSchema),
  viewDays: z.array(repositoryCloneSchema),
  views: z.object({
    total: z.number().nullable(),
    complete: z.boolean(),
    comparison: z.number().nullable(),
  }),
  truncated: z.boolean(),
});
export type RepositoryMetrics = z.infer<typeof repositoryMetricsSchema>;
export const trafficStatusSchema = z.object({
  repositoryId: idSchema,
  metric: z.enum(['clones', 'views', 'paths', 'referrers']),
  lastAttempt: z.string(),
  lastSuccess: z.string().nullable(),
  status: z.enum(['success', 'failed', 'deferred', 'unknown']),
  error: z.string().nullable(),
});

export const repositorySyncSchema = z.object({
  repositories: z.array(repositorySchema),
  repositoryTotal: z.number(),
  trafficStatuses: z.array(trafficStatusSchema),
  attemptTotal: z.number(),
  attempts: z.array(
    z.object({
      id: z.string(),
      repositoryId: idSchema,
      repositoryName: z.string(),
      startedAt: z.string(),
      finishedAt: z.string().nullable(),
      status: z.string(),
      error: z.string().nullable(),
    }),
  ),
});

export const trafficMetricSchema = z.enum(['views', 'paths', 'referrers']);
export type TrafficMetric = z.infer<typeof trafficMetricSchema>;
export const trafficItemSchema = z.object({
  identity: z.string(),
  title: z.string().nullable(),
  count: z.number().int().nonnegative(),
  uniques: z.number().int().nonnegative(),
});
export const trafficSnapshotSchema = z.object({
  id: idSchema,
  repositoryId: idSchema,
  metric: trafficMetricSchema,
  observedAt: z.string(),
  windowDays: z.literal(14),
  count: z.number().nullable(),
  uniques: z.number().nullable(),
  itemCount: z.number().int().nonnegative(),
});
export const trafficDetailSchema = trafficSnapshotSchema.extend({
  items: z.array(trafficItemSchema).max(10),
});
export const trafficListSchema = z.object({
  items: z.array(
    z.object({
      repositoryId: idSchema,
      repositoryName: z.string(),
      snapshots: z.array(trafficSnapshotSchema),
      statuses: z.array(trafficStatusSchema),
    }),
  ),
  total: z.number(),
});
