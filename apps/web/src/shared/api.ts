import type { z } from 'zod';
export async function api<T extends z.ZodType>(
  path: string,
  schema: T,
  options: RequestInit = {},
): Promise<z.infer<T>> {
  const response = await fetch('/api/v1' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error?.message ?? 'Request failed. Your session may have expired.');
  }
  return schema.parse(await response.json());
}
export async function mutate(path: string, method: string, value?: unknown) {
  const response = await fetch('/api/v1' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? 'Request failed.');
  return data;
}
export const number = (value: number | null | undefined) =>
  value == null ? '—' : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
export const utc = (value: string | null | undefined) =>
  value ? new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'Never';
