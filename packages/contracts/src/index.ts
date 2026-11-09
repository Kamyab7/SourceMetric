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
  offset: z.coerce.number().int().min(0).max(100000).default(0),
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
  attempts: z.array(
    z.object({
      id: z.string(),
      packageId: z.string(),
      startedAt: z.string(),
      finishedAt: z.string().nullable(),
      status: z.string(),
      error: z.string().nullable(),
    }),
  ),
});
