import { and, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { loginAttempts, sessions, users, type UserRow } from "../db/schema";
import { hashPassword, newSessionToken, sha256Hex, verifyPassword } from "./crypto";
import { fail, parseJson } from "./http";
import type { ApiUser, AppEnv } from "./types";
import { loginBody, passwordBody } from "./validation";

export const SESSION_COOKIE = "gl_session";
const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 90 * DAY_MS;
/** Sessions with less than this left are extended to a fresh 90 days (sliding expiry). */
const SESSION_REFRESH_BELOW_MS = 30 * DAY_MS;

export const RATE_LIMIT_MAX_FAILURES = 5;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
};

/** A valid hash to verify against when the email is unknown, so timing doesn't reveal which emails exist. */
let dummyHash: Promise<{ hash: string; salt: string; iterations: number }> | undefined;

export function toApiUser(u: Pick<UserRow, "id" | "email" | "displayName" | "personId">): ApiUser {
  return { id: u.id, email: u.email, displayName: u.displayName, personId: u.personId ?? null };
}

function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") ?? "unknown";
}

/** Requires a valid session on every request it guards; sets c.var.user and refreshes the session. */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) fail(401, "Not signed in");
  const db = c.var.db;
  const id = await sha256Hex(token);
  const row = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  const now = Date.now();
  if (!row) fail(401, "Not signed in");
  const expiresAt = Date.parse(row.session.expiresAt);
  if (!(expiresAt > now)) {
    await db.delete(sessions).where(eq(sessions.id, id));
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
    fail(401, "Session expired");
  }
  if (expiresAt - now < SESSION_REFRESH_BELOW_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now + SESSION_TTL_MS).toISOString() })
      .where(eq(sessions.id, id));
    setCookie(c, SESSION_COOKIE, token, cookieOptions);
  }
  c.set("user", toApiUser(row.user));
  c.set("sessionId", id);
  await next();
};

export const authRoutes = new Hono<AppEnv>();

/** The keys a sign-in attempt counts against: per email (when known) and per IP. */
export function loginKeys(req: Request, email?: string): string[] {
  return [...(email ? [`email:${email}`] : []), `ip:${clientIp(req)}`];
}

/** 429s if any key has too many recent failures (the shared login rate limit). */
export async function checkLoginRateLimit(c: Context<AppEnv>, keys: string[], now = Date.now()): Promise<void> {
  const db = c.var.db;
  const since = now - RATE_LIMIT_WINDOW_MS;
  // Opportunistic cleanup of old attempts, then the rate-limit check.
  await db.delete(loginAttempts).where(lt(loginAttempts.at, since));
  const recent = await db
    .select({ key: loginAttempts.key })
    .from(loginAttempts)
    .where(and(inArray(loginAttempts.key, keys), gte(loginAttempts.at, since)))
    .all();
  const failuresByKey = new Map<string, number>();
  for (const r of recent) failuresByKey.set(r.key, (failuresByKey.get(r.key) ?? 0) + 1);
  if (keys.some((k) => (failuresByKey.get(k) ?? 0) >= RATE_LIMIT_MAX_FAILURES)) {
    c.header("Retry-After", String(RATE_LIMIT_WINDOW_MS / 1000));
    fail(429, "Too many failed sign-in attempts. Try again in 15 minutes.");
  }
}

export async function recordLoginFailure(c: Context<AppEnv>, keys: string[], now = Date.now()): Promise<void> {
  await c.var.db.insert(loginAttempts).values(keys.map((key) => ({ key, at: now })));
}

/** Clears the failure counters, creates a session and sets the cookie (shared by password and passkey login). */
export async function startSession(c: Context<AppEnv>, user: UserRow, keys: string[], now = Date.now()): Promise<void> {
  const db = c.var.db;
  await db.delete(loginAttempts).where(inArray(loginAttempts.key, keys));
  const { token, id } = await newSessionToken();
  await db.insert(sessions).values({
    id,
    userId: user.id,
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    createdAt: new Date(now).toISOString(),
    userAgent: c.req.header("User-Agent")?.slice(0, 500) ?? null,
  });
  setCookie(c, SESSION_COOKIE, token, cookieOptions);
}

authRoutes.post("/login", async (c) => {
  const { email, password } = await parseJson(c, loginBody);
  const db = c.var.db;
  const now = Date.now();
  const keys = loginKeys(c.req.raw, email);
  await checkLoginRateLimit(c, keys, now);

  const user = await db.select().from(users).where(eq(users.email, email)).get();
  let ok: boolean;
  if (user) {
    ok = await verifyPassword(password, {
      hash: user.passwordHash,
      salt: user.passwordSalt,
      iterations: user.passwordIterations,
    });
  } else {
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(password, await dummyHash);
    ok = false;
  }

  if (!ok || !user) {
    await recordLoginFailure(c, keys, now);
    fail(401, "Incorrect email or password");
  }

  await startSession(c, user, keys, now);
  return c.json({ user: toApiUser(user) });
});

/** Routes below require a session (the middleware is applied by the parent app). */
export const authSessionRoutes = new Hono<AppEnv>();

authSessionRoutes.post("/logout", async (c) => {
  await c.var.db.delete(sessions).where(eq(sessions.id, c.var.sessionId));
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "Lax" });
  return c.json({ ok: true });
});

authSessionRoutes.get("/me", (c) => c.json({ user: c.var.user }));

authSessionRoutes.post("/password", async (c) => {
  const { currentPassword, newPassword } = await parseJson(c, passwordBody);
  const db = c.var.db;
  const user = await db.select().from(users).where(eq(users.id, c.var.user.id)).get();
  if (!user) fail(401, "Not signed in");
  const ok = await verifyPassword(currentPassword, {
    hash: user.passwordHash,
    salt: user.passwordSalt,
    iterations: user.passwordIterations,
  });
  if (!ok) fail(400, "Current password is incorrect");
  const h = await hashPassword(newPassword);
  await db.batch([
    db
      .update(users)
      .set({ passwordHash: h.hash, passwordSalt: h.salt, passwordIterations: h.iterations })
      .where(eq(users.id, user.id)),
    // Sign out every other device; keep the current session.
    db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, c.var.sessionId))),
  ]);
  return c.json({ ok: true });
});
