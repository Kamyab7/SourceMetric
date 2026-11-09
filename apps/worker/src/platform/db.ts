import { drizzle } from 'drizzle-orm/d1';
export const database = (binding: D1Database) => drizzle(binding);
export function bool(value: unknown) {
  return value === 1 || value === true;
}
export const nowIso = () => new Date().toISOString();
