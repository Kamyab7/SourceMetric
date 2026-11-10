import { it, expect, vi } from 'vitest';
import { GitHubProvider, repositoryName } from '../apps/worker/src/providers/github/provider';
const metadata = {
  id: 123,
  full_name: 'owner/tool',
  description: null,
  private: true,
  stargazers_count: 12,
  forks_count: 3,
};
function fixture(responses: Response[]) {
  const fetcher = vi.fn<typeof fetch>(async () => responses.shift()!);
  return { provider: new GitHubProvider('secret-test-token', fetcher), fetcher };
}
const json = (data: unknown) => Response.json(data);
it('accepts GitHub identities and refuses other hosts or arbitrary paths', () => {
  expect(repositoryName('https://github.com/Owner/Tool.git')).toBe('Owner/Tool');
  for (const input of [
    'https://evil.test/owner/tool',
    'owner/tool/issues',
    '../..',
    'https://github.com/owner/tool?x=1',
  ])
    expect(() => repositoryName(input)).toThrow();
});
it('requires configuration without fetching or exposing credentials', async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(new GitHubProvider(undefined, fetcher).resolve('owner/tool')).rejects.toMatchObject({
    code: 'GITHUB_NOT_CONFIGURED',
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it('resolves metadata and collects by immutable ID using the current name after a transfer', async () => {
  const { provider, fetcher } = fixture([
    json(metadata),
    json({ ...metadata, full_name: 'new/renamed' }),
    json({
      count: 5,
      uniques: 3,
      clones: [{ timestamp: '2026-01-01T00:00:00Z', count: 5, uniques: 3 }],
    }),
  ]);
  expect(await provider.resolve('owner/tool')).toMatchObject({
    githubId: '123',
    private: true,
    stars: 12,
  });
  const result = await provider.collect('123');
  expect(result.metadata.fullName).toBe('new/renamed');
  expect(result.traffic.days).toEqual([{ day: '2026-01-01T00:00:00.000Z', count: 5, uniques: 3 }]);
  expect(fetcher.mock.calls[1]![0]).toBe('https://api.github.com/repositories/123');
  expect(fetcher.mock.calls[2]![0]).toContain('/repos/new/renamed/traffic/clones?per=day');
});
it('preserves metadata when traffic is denied and never exposes upstream bodies', async () => {
  const { provider } = fixture([
    json(metadata),
    new Response('sensitive upstream content', { status: 403 }),
  ]);
  const result = await provider.collect('123');
  expect(result.metadata.stars).toBe(12);
  expect(result.traffic).toEqual({
    days: null,
    error: 'GITHUB_ACCESS_DENIED',
    retryAfter: undefined,
  });
  const denied = fixture([new Response('secret-test-token', { status: 404 })]);
  await expect(denied.provider.resolve('owner/tool')).rejects.toMatchObject({
    code: 'GITHUB_ACCESS_DENIED',
  });
});
it('honors retry-after and primary rate-limit resets', async () => {
  const reset = Math.ceil(Date.now() / 1000) + 7200;
  const first = fixture([
    new Response('', {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    }),
  ]);
  await expect(first.provider.resolve('owner/tool')).rejects.toMatchObject({
    code: 'GITHUB_RATE_LIMITED',
    retryAfter: expect.any(Number),
  });
  const second = fixture([
    json(metadata),
    new Response('', { status: 429, headers: { 'retry-after': '9000' } }),
  ]);
  expect((await second.provider.collect('123')).traffic).toMatchObject({
    error: 'GITHUB_RATE_LIMITED',
    retryAfter: 9000000,
  });
});
it('rejects malformed data, oversized responses, invalid buckets, and unsafe redirects', async () => {
  for (const response of [
    json({ id: 1 }),
    new Response('x'.repeat(2 * 1024 * 1024 + 1)),
    new Response(null, { status: 301, headers: { location: 'https://evil.test/repos/a/b' } }),
  ]) {
    await expect(fixture([response]).provider.resolve('owner/tool')).rejects.toMatchObject({
      code: 'GITHUB_RESPONSE_INVALID',
    });
  }
  const result = await fixture([
    json(metadata),
    json({
      count: 1,
      uniques: 1,
      clones: [{ timestamp: '2026-01-01T01:00:00Z', count: 1, uniques: 1 }],
    }),
  ]).provider.collect('123');
  expect(result.traffic.error).toBe('GITHUB_RESPONSE_INVALID');
});
it('follows only validated GitHub redirects and safely categorizes timeouts', async () => {
  const { provider } = fixture([
    new Response(null, {
      status: 301,
      headers: { location: 'https://api.github.com/repositories/123' },
    }),
    json(metadata),
  ]);
  expect((await provider.resolve('old/tool')).githubId).toBe('123');
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new DOMException('secret-test-token', 'TimeoutError');
  });
  await expect(
    new GitHubProvider('secret-test-token', fetcher).resolve('owner/tool'),
  ).rejects.toMatchObject({
    code: 'GITHUB_RESPONSE_INVALID',
    message: 'GitHub request failed or returned invalid data.',
  });
});
