import { it, expect, vi } from 'vitest';
import { GitHubProvider } from '../apps/worker/src/providers/github/provider';
import { contentUrl } from '../apps/web/src/features/repositories/content-url';
const metadata = {
  id: 123,
  full_name: 'owner/tool',
  description: null,
  private: false,
  stargazers_count: 12,
  forks_count: 3,
};
const day = { timestamp: '2026-01-01T00:00:00Z', count: 5, uniques: 3 };
const clones = { count: 5, uniques: 3, clones: [day] },
  views = { count: 10, uniques: 4, views: [{ ...day, count: 10, uniques: 4 }] };
const path = { path: '/owner/tool/blob/main/README.md', title: 'Read me', count: 5, uniques: 3 };
function fixture(data: (unknown | Response)[]) {
  const fetcher = vi.fn<typeof fetch>(async () => {
    const response = data.shift();
    return response instanceof Response ? response : Response.json(response);
  });
  return { provider: new GitHubProvider('fixture', fetcher), fetcher };
}
it('collects the four traffic endpoints sequentially, preserving source totals and ranking', async () => {
  const { provider, fetcher } = fixture([
    metadata,
    clones,
    views,
    [path, { ...path, path: '/owner/tool', title: 'Home', count: 1, uniques: 1 }],
    [{ referrer: 'Google', count: 3, uniques: 2 }],
  ]);
  const result = await provider.collect('123');
  expect(result.views).toEqual({
    data: {
      count: 10,
      uniques: 4,
      days: [{ day: '2026-01-01T00:00:00.000Z', count: 10, uniques: 4 }],
    },
    error: null,
  });
  expect(result.paths!.data!.map((p) => p.identity)).toEqual([path.path, '/owner/tool']);
  expect(result.referrers!.data![0]).toMatchObject({ identity: 'Google', title: null });
  expect(fetcher.mock.calls.map((c) => String(c[0]).split('/traffic/')[1])).toEqual([
    undefined,
    'clones?per=day',
    'views?per=day',
    'popular/paths',
    'popular/referrers',
  ]);
});
it('keeps endpoint failures independent, including malformed popular content', async () => {
  const { provider } = fixture([
    metadata,
    new Response('private', { status: 403 }),
    views,
    [{ ...path, uniques: 100 }],
    [{ referrer: 'Google', count: 3, uniques: 2 }],
  ]);
  const result = await provider.collect('123');
  expect(result.traffic.error).toBe('GITHUB_ACCESS_DENIED');
  expect(result.views!.error).toBeNull();
  expect(result.paths!.error).toBe('GITHUB_RESPONSE_INVALID');
  expect(result.referrers!.error).toBeNull();
});
it('treats empty popular lists and empty view days as successful responses', async () => {
  const result = await fixture([
    metadata,
    clones,
    { count: 0, uniques: 0, views: [] },
    [],
    [],
  ]).provider.collect('123');
  expect(result.views!.data).toEqual({ count: 0, uniques: 0, days: [] });
  expect(result.paths).toEqual({ data: [], error: null });
  expect(result.referrers).toEqual({ data: [], error: null });
});
it('defers remaining endpoints and subsequent repositories after rate limiting', async () => {
  const { provider, fetcher } = fixture([
    metadata,
    clones,
    new Response('', { status: 429, headers: { 'retry-after': '9000' } }),
  ]);
  const result = await provider.collect('123');
  expect(result.views).toMatchObject({ error: 'GITHUB_RATE_LIMITED', retryAfter: 9000000 });
  expect(result.paths).toMatchObject({ error: 'GITHUB_RATE_LIMITED', deferred: true });
  expect(result.referrers).toMatchObject({ error: 'GITHUB_RATE_LIMITED', deferred: true });
  await expect(provider.collect('456')).rejects.toMatchObject({ code: 'GITHUB_RATE_LIMITED' });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('rejects malformed daily traffic and oversized or duplicate top lists', async () => {
  for (const invalid of [
    { count: -1, uniques: 0, views: [] },
    { count: 10, uniques: 11, views: [] },
    { count: 10, uniques: 3, views: [day, day] },
    { count: 10, uniques: 3, views: [{ ...day, timestamp: '2026-01-01T01:00:00Z' }] },
  ]) {
    expect(
      (await fixture([metadata, clones, invalid, [], []]).provider.collect('123')).views!.error,
    ).toBe('GITHUB_RESPONSE_INVALID');
  }
  for (const invalid of [
    [path, path],
    Array.from({ length: 11 }, (_, i) => ({ ...path, path: '/path' + i })),
    [{ ...path, title: 5 }],
  ])
    expect(
      (await fixture([metadata, clones, views, invalid, []]).provider.collect('123')).paths!.error,
    ).toBe('GITHUB_RESPONSE_INVALID');
});
it('only constructs safe GitHub links from content paths', () => {
  expect(contentUrl('/owner/tool/blob/main/README.md')).toBe(
    'https://github.com/owner/tool/blob/main/README.md',
  );
  for (const input of [
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/%2f%2fevil.test',
    '/%5cevil.test',
    '/\n/evil',
    '/%00evil',
    'javascript:alert(1)',
    '/%zz',
  ])
    expect(contentUrl(input)).toBeUndefined();
});
