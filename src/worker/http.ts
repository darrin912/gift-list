import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

/** Throws an error that the app's onError turns into `{ error: message }` with `status`. */
export function fail(status: 400 | 401 | 403 | 404 | 409 | 429, message: string): never {
  throw new HTTPException(status, { message });
}

export function notFound(what = "Not found"): never {
  fail(404, what);
}

/** Formats the first zod issue as a short human-readable message. */
export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    fail(400, "Invalid JSON body");
  }
  const result = schema.safeParse(body);
  if (!result.success) fail(400, zodMessage(result.error));
  return result.data;
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.output<T> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) fail(400, zodMessage(result.error));
  return result.data;
}

/** Parses a positive integer route param; anything else is a 404. */
export function idParam(c: Context, name = "id"): number {
  const raw = c.req.param(name) ?? "";
  if (!/^\d{1,15}$/.test(raw)) notFound();
  const n = Number(raw);
  if (n <= 0) notFound();
  return n;
}
