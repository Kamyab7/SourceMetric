import type { Context } from 'hono';
import type { z } from 'zod';
import { AppError } from './errors';
export type AppBindings = { Bindings: Env };
export async function body<T extends z.ZodType>(
  c: Context<AppBindings>,
  schema: T,
): Promise<z.infer<T>> {
  if (Number(c.req.header('content-length')) > 16384)
    throw new AppError(400, 'INVALID_INPUT', 'Request body is too large.');
  const text = await c.req.text();
  if (text.length > 16384) throw new AppError(400, 'INVALID_INPUT', 'Request body is too large.');
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw new AppError(400, 'INVALID_INPUT', 'Request fields are invalid.');
  }
}
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(400, 'INVALID_INPUT', result.error.issues[0]?.message ?? 'Invalid input.');
  return result.data;
}
