import type { ZodType } from 'zod';

export function parseOrThrow<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    const err = new Error(msg);
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }
  return r.data;
}
