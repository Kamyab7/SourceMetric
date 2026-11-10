import { z } from 'zod';
import { AppError } from '../../platform/errors';
export interface RepositoryMetadata {
  githubId: string;
  fullName: string;
  url: string;
  description: string;
  private: boolean;
  stars: number;
  forks: number;
}
export interface CloneDay {
  day: string;
  count: number;
  uniques: number;
}
export interface RepositoryCollection {
  metadata: RepositoryMetadata;
  traffic: { days: CloneDay[]; error: null } | { days: null; error: string; retryAfter?: number };
}
export interface RepositoryProvider {
  resolve(input: string): Promise<RepositoryMetadata>;
  collect(githubId: string): Promise<RepositoryCollection>;
}
const counter = z.number().int().nonnegative().safe();
const metadataSchema = z.object({
  id: z.number().int().positive().safe(),
  full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  description: z.string().nullable(),
  private: z.boolean(),
  stargazers_count: counter,
  forks_count: counter,
});
const trafficSchema = z.object({
  count: counter,
  uniques: counter,
  clones: z
    .array(
      z.object({
        timestamp: z.iso.datetime(),
        count: counter,
        uniques: counter,
      }),
    )
    .max(14),
});
export function repositoryName(input: string) {
  const name = input
    .replace(/^https:\/\/github\.com\//i, '')
    .replace(/\/$/, '')
    .replace(/\.git$/, '');
  if (!/^[a-zA-Z0-9-]{1,39}\/[a-zA-Z0-9_.-]{1,100}$/.test(name) || name.split('/')[1] === '..')
    throw new AppError(
      400,
      'INVALID_INPUT',
      'Use owner/repo or an HTTPS github.com repository URL.',
    );
  return name;
}
export class GitHubProvider implements RepositoryProvider {
  constructor(
    private token?: string,
    private fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  private async request(path: string): Promise<unknown> {
    if (!this.token)
      throw new AppError(503, 'GITHUB_NOT_CONFIGURED', 'Configure the GITHUB_TOKEN Worker secret.');
    try {
      // Do not follow redirects with a credential. Collection uses immutable IDs, resolution retries a validated GitHub path.
      let url = 'https://api.github.com' + path;
      for (let redirects = 0; redirects < 3; redirects++) {
        const response = await this.fetcher(url, {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: 'Bearer ' + this.token,
            'User-Agent': 'SourceMetric',
            'X-GitHub-Api-Version': '2026-03-10',
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(12000),
        });
        if ([301, 302, 307, 308].includes(response.status)) {
          const target = new URL(response.headers.get('location') ?? '', url);
          await response.body?.cancel();
          if (
            target.origin !== 'https://api.github.com' ||
            target.username ||
            target.password ||
            !/^\/(repos|repositories)\//.test(target.pathname)
          )
            throw new AppError(
              502,
              'GITHUB_RESPONSE_INVALID',
              'GitHub returned an invalid redirect.',
            );
          url = target.href;
          continue;
        }
        if (!response.ok) {
          const retry = response.headers.get('retry-after');
          const retryMs = retry
            ? /^\d+$/.test(retry)
              ? Number(retry) * 1000
              : Date.parse(retry) - Date.now()
            : 0;
          const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
          const limited =
            response.status === 429 ||
            (response.status === 403 &&
              (response.headers.get('x-ratelimit-remaining') === '0' || !!retry));
          await response.body?.cancel();
          if (limited)
            throw new AppError(
              429,
              'GITHUB_RATE_LIMITED',
              'GitHub rate limit reached; collection will retry.',
              Math.max(60000, retryMs || 0, reset || 0),
            );
          if ([401, 403, 404].includes(response.status))
            throw new AppError(
              502,
              'GITHUB_ACCESS_DENIED',
              'GitHub repository or metric is unavailable to the configured token.',
            );
          throw new AppError(502, 'GITHUB_UNAVAILABLE', 'GitHub is temporarily unavailable.');
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error();
        const decoder = new TextDecoder();
        let text = '',
          bytes = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 2 * 1024 * 1024) {
            await reader.cancel();
            throw new Error();
          }
          text += decoder.decode(part.value, { stream: true });
        }
        return JSON.parse(text + decoder.decode());
      }
      throw new Error();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        'GITHUB_RESPONSE_INVALID',
        'GitHub request failed or returned invalid data.',
      );
    }
  }
  private async metadata(path: string) {
    const result = metadataSchema.safeParse(await this.request(path));
    if (!result.success)
      throw new AppError(
        502,
        'GITHUB_RESPONSE_INVALID',
        'GitHub returned invalid repository data.',
      );
    const m = result.data;
    return {
      githubId: String(m.id),
      fullName: m.full_name,
      url: 'https://github.com/' + m.full_name,
      description: m.description ?? '',
      private: m.private,
      stars: m.stargazers_count,
      forks: m.forks_count,
    };
  }
  resolve(input: string) {
    return this.metadata('/repos/' + repositoryName(input));
  }
  async collect(githubId: string): Promise<RepositoryCollection> {
    if (!/^\d+$/.test(githubId))
      throw new AppError(400, 'INVALID_INPUT', 'Invalid GitHub identity.');
    const metadata = await this.metadata('/repositories/' + githubId);
    try {
      const result = trafficSchema.safeParse(
        await this.request('/repos/' + metadata.fullName + '/traffic/clones?per=day'),
      );
      if (!result.success)
        throw new AppError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub returned invalid clone data.');
      const days = result.data.clones.map((d) => ({
        day: new Date(d.timestamp).toISOString(),
        count: d.count,
        uniques: d.uniques,
      }));
      if (
        new Set(days.map((d) => d.day)).size !== days.length ||
        days.some(
          (d) =>
            !d.day.endsWith('T00:00:00.000Z') ||
            d.uniques > d.count ||
            Date.parse(d.day) > Date.now(),
        )
      )
        throw new AppError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub returned invalid clone dates.');
      return { metadata, traffic: { days, error: null } };
    } catch (error) {
      return {
        metadata,
        traffic: {
          days: null,
          error: error instanceof AppError ? error.code : 'GITHUB_UNAVAILABLE',
          retryAfter: error instanceof AppError ? error.retryAfter : undefined,
        },
      };
    }
  }
}
