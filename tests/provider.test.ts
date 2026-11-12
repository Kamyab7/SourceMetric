import { it, expect, vi } from 'vitest';
import { NuGetProvider } from '../apps/worker/src/providers/nuget/provider';
import { createPackageProvider } from '../apps/worker/src/providers/factory';
function fixture(data: unknown) {
  const mock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        resources: [{ '@id': 'https://search.nuget.org/query', '@type': 'SearchQueryService' }],
      }),
    )
    .mockResolvedValue(Response.json({ data }));
  return { provider: new NuGetProvider({ fetch: mock }), mock };
}
it('discovers endpoints, exact matches case-insensitively, and includes prereleases', async () => {
  const { provider, mock } = fixture([
    { id: 'Other.Package', versions: [] },
    {
      id: 'Example.Core',
      totalDownloads: 30,
      versions: [
        { version: '1.0.0', downloads: 20 },
        { version: '2.0.0-beta.1', downloads: 10 },
      ],
    },
  ]);
  const result = await provider.collect('EXAMPLE.CORE', '2026-01-01T00:00:00Z');
  expect(result.metadata.canonicalId).toBe('example.core');
  expect(result.metadata.latestPrerelease).toBe('2.0.0-beta.1');
  expect(result.observations.map((o) => o.value)).toEqual([30, 10, 20]);
  const url = new URL(String(mock.mock.calls[1]?.[0]));
  expect(url.searchParams.get('prerelease')).toBe('true');
  expect(url.searchParams.get('semVerLevel')).toBe('2.0.0');
  expect(mock.mock.calls.every(([, options]) => options?.redirect === 'manual')).toBe(true);
});
it('rejects registry redirects without following them', async () => {
  const mock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: 'https://example.com/query' } }),
    );
  await expect(new NuGetProvider({ fetch: mock }).resolve('Example')).rejects.toMatchObject({
    code: 'REGISTRY_UNAVAILABLE',
  });
  expect(mock).toHaveBeenCalledTimes(1);
  expect(mock.mock.calls[0]?.[1]?.redirect).toBe('manual');
});
it('preserves missing counters and rejects unavailable packages and unknown providers', async () => {
  const { provider } = fixture([{ id: 'Example', versions: [{ version: '1.0.0' }] }]);
  expect(
    (await provider.collect('Example', '2026-01-01T00:00:00Z')).observations[0]?.value,
  ).toBeNull();
  await expect(fixture([]).provider.resolve('missing')).rejects.toMatchObject({
    code: 'PACKAGE_UNAVAILABLE',
  });
  expect(() => createPackageProvider('npm')).toThrow('not supported');
});
it('honors upstream retry hints', async () => {
  const mock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        resources: [{ '@id': 'https://search.nuget.org/query', '@type': 'SearchQueryService' }],
      }),
    )
    .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
  await expect(new NuGetProvider({ fetch: mock }).resolve('test')).rejects.toMatchObject({
    code: 'RATE_LIMITED',
    retryAfter: 120000,
  });
});
