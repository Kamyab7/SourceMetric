import { createPackageProvider } from '../../providers/factory';
import type { PackageProvider } from '../../providers/contracts';
import { AppError } from '../../platform/errors';
import { dueJobs, claimJob, commitCollection, failCollection } from './repository';
const HOUR = 3600000;
export async function collectDue(
  db: D1Database,
  options: { now?: Date; provider?: (id: string) => PackageProvider } = {},
) {
  const now = options.now ?? new Date(),
    iso = now.toISOString(),
    started = performance.now();
  const jobs = await dueJobs(db, iso);
  const providers = new Map<string, PackageProvider>();
  let cursor = 0,
    successes = 0,
    failures = 0;
  const work = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      if (!job) continue;
      const token = crypto.randomUUID(),
        leaseUntil = new Date(now.getTime() + 5 * 60000).toISOString();
      if (!(await claimJob(db, job.package_id, token, iso, leaseUntil))) continue;
      try {
        let provider = providers.get(job.provider);
        if (!provider) {
          provider = options.provider?.(job.provider) ?? createPackageProvider(job.provider);
          providers.set(job.provider, provider);
        }
        const result = await provider.collect(job.canonical_id, iso);
        await commitCollection(
          db,
          job,
          token,
          iso,
          new Date(now.getTime() + 6 * HOUR).toISOString(),
          result,
        );
        successes++;
      } catch (error) {
        const code = error instanceof AppError ? error.code : 'COLLECTION_FAILED';
        const delay = Math.max(
          Math.min(2 ** Math.min(job.failures, 8) * HOUR, 24 * HOUR),
          error instanceof AppError ? (error.retryAfter ?? 0) : 0,
        );
        await failCollection(
          db,
          job.package_id,
          token,
          iso,
          new Date(now.getTime() + delay).toISOString(),
          code,
        );
        failures++;
        console.warn(
          JSON.stringify({ event: 'collection_failed', packageId: job.package_id, code }),
        );
      }
    }
  };
  await Promise.all([work(), work()]);
  const report = {
    event: 'collection_completed',
    packages: jobs.length,
    successes,
    failures,
    elapsedMs: Math.round(performance.now() - started),
  };
  console.log(JSON.stringify(report));
  return report;
}
