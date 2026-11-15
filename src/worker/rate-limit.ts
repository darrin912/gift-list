// A sliding-window rate limit backed by D1 (in-memory counters don't survive across isolates).
import { and, count, eq, gte, lt } from "drizzle-orm";
import { rateLimitEvents } from "../db/schema";
import type { Variables } from "./types";

type Db = Variables["db"];

/**
 * Records one event for `key` and returns true, or returns false (recording nothing) if
 * `max` events already happened within the last `windowMs`.
 */
export async function takeRateLimit(db: Db, key: string, max: number, windowMs: number, now = Date.now()): Promise<boolean> {
  const since = now - windowMs;
  const [, rows] = await db.batch([
    db.delete(rateLimitEvents).where(and(eq(rateLimitEvents.key, key), lt(rateLimitEvents.at, since))),
    db.select({ n: count() }).from(rateLimitEvents).where(and(eq(rateLimitEvents.key, key), gte(rateLimitEvents.at, since))),
  ]);
  if ((rows[0]?.n ?? 0) >= max) return false;
  await db.insert(rateLimitEvents).values({ key, at: now });
  return true;
}
