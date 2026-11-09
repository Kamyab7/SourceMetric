import { z } from 'zod';
import { rcompare, valid } from 'semver';
import { AppError } from '../../platform/errors';
import type {
  PackageProvider,
  ProviderDependencies,
  PackageMetadata,
  ProviderObservation,
} from '../contracts';
const counter = z.number().int().nonnegative().safe();
const resultSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      description: z.string().optional(),
      totalDownloads: counter.optional(),
      versions: z.array(z.object({ version: z.string(), downloads: counter.optional() })),
    }),
  ),
});
type SearchItem = z.infer<typeof resultSchema>['data'][number];
function registryData<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(502, 'INVALID_SOURCE', 'Registry returned invalid package data.');
  return result.data;
}
function toMetadata(item: SearchItem): PackageMetadata {
  const versions = item.versions
    .map((v) => ({
      version: v.version,
      prerelease: v.version.includes('-'),
      downloads: v.downloads ?? null,
    }))
    .sort((a, b) =>
      valid(a.version) && valid(b.version)
        ? rcompare(a.version, b.version)
        : b.version.localeCompare(a.version, undefined, { numeric: true }),
    );
  return {
    canonicalId: item.id.toLowerCase(),
    displayName: item.id,
    description: item.description ?? '',
    latestStable: versions.find((v) => !v.prerelease)?.version ?? null,
    latestPrerelease: versions.find((v) => v.prerelease)?.version ?? null,
    versions,
  };
}
export class NuGetProvider implements PackageProvider {
  readonly id = 'nuget';
  private endpoint?: string;
  constructor(private deps: ProviderDependencies) {}
  capabilities() {
    return { packageDownloads: 'cumulative' as const, versionDownloads: true, prereleases: true };
  }
  private async json(url: string): Promise<unknown> {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      !(parsed.hostname === 'nuget.org' || parsed.hostname.endsWith('.nuget.org'))
    )
      throw new AppError(502, 'INVALID_SOURCE', 'Registry returned an invalid endpoint.');
    const response = await this.deps.fetch(url, {
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      const header = response.headers.get('retry-after');
      const seconds = header
        ? /^\d+$/.test(header)
          ? Number(header)
          : (Date.parse(header) - Date.now()) / 1000
        : undefined;
      throw new AppError(
        502,
        response.status === 429 ? 'RATE_LIMITED' : 'REGISTRY_UNAVAILABLE',
        'NuGet could not provide package data.',
        seconds && seconds > 0 ? Math.min(seconds, 86400) * 1000 : undefined,
      );
    }
    if (Number(response.headers.get('content-length')) > 2_000_000)
      throw new AppError(502, 'RESPONSE_TOO_LARGE', 'Registry response exceeded the size limit.');
    const reader = response.body?.getReader();
    if (!reader) throw new AppError(502, 'INVALID_SOURCE', 'Empty registry response.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 2_000_000)
          throw new AppError(
            502,
            'RESPONSE_TOO_LARGE',
            'Registry response exceeded the size limit.',
          );
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new AppError(502, 'INVALID_SOURCE', 'Registry returned invalid data.');
    }
  }
  private async search(id: string) {
    if (!this.endpoint) {
      const index = registryData(
        z.object({ resources: z.array(z.object({ '@id': z.string(), '@type': z.string() })) }),
        await this.json('https://api.nuget.org/v3/index.json'),
      );
      this.endpoint = index.resources.find((r) => r['@type'] === 'SearchQueryService')?.['@id'];
      if (!this.endpoint) throw new AppError(502, 'INVALID_SOURCE', 'NuGet search is unavailable.');
    }
    const url = new URL(this.endpoint);
    url.search = new URLSearchParams({
      q: 'packageid:' + id,
      prerelease: 'true',
      semVerLevel: '2.0.0',
      take: '20',
    }).toString();
    return registryData(resultSchema, await this.json(url.toString())).data.find(
      (p) => p.id.toLowerCase() === id.toLowerCase(),
    );
  }
  async metadata(id: string): Promise<PackageMetadata> {
    const item = await this.search(id);
    if (!item) throw new AppError(404, 'PACKAGE_UNAVAILABLE', 'Listed NuGet package not found.');
    return toMetadata(item);
  }
  resolve(id: string) {
    return this.metadata(id);
  }
  async collect(id: string, observedAt: string) {
    // Read metadata and counters from the same registry response.
    const item = await this.search(id);
    if (!item) throw new AppError(404, 'PACKAGE_UNAVAILABLE', 'Listed NuGet package not found.');
    const metadata = toMetadata(item),
      versions = metadata.versions;
    const total =
      item.totalDownloads ??
      (versions.every((v) => v.downloads !== null)
        ? versions.reduce((s, v) => s + (v.downloads ?? 0), 0)
        : null);
    const observation = (
      scope: 'package' | 'version',
      value: number | null,
      version?: string,
    ): ProviderObservation => ({
      provider: this.id,
      canonicalId: metadata.canonicalId,
      metric: 'downloads',
      scope,
      version,
      kind: 'cumulative',
      value,
      observedAt,
      availability: value === null ? 'unavailable' : 'available',
      quality: value === null ? 'unavailable' : 'source',
    });
    return {
      metadata,
      observations: [
        observation('package', total),
        ...versions.map((v) => observation('version', v.downloads, v.version)),
      ],
    };
  }
}
