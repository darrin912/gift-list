// Passkeys (WebAuthn) with @simplewebauthn/server.
// RP ID = the request hostname; the origin is checked against the request origin (plus, in local
// dev only, a localhost Origin header such as the Vite dev server's). Challenges live in D1 with
// a 5-minute TTL and are deleted when used, so each one works once.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, asc, eq, gt, lt } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { passkeys, users, webauthnChallenges } from "../db/schema";
import { checkLoginRateLimit, loginKeys, recordLoginFailure, startSession, toApiUser } from "./auth";
import { base64Url } from "./crypto";
import { fail, idParam, notFound, parseJson } from "./http";
import { takeRateLimit } from "./rate-limit";
import type { AppEnv, Variables } from "./types";
import { passkeyLoginVerifyBody, passkeyRegisterVerifyBody } from "./validation";

type Db = Variables["db"];

export const RP_NAME = "Gift List";
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const PASSKEY_OPTIONS_MAX_PER_MINUTE = 20;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface ApiPasskey {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

// ---------------------------------------------------------------- helpers

export function rpFor(req: Request): { rpID: string; origins: string[] } {
  const url = new URL(req.url);
  const origins = [url.origin];
  if (LOCAL_HOSTS.has(url.hostname)) {
    const header = req.headers.get("Origin");
    if (header && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(header)) origins.push(header);
  }
  return { rpID: url.hostname, origins };
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The challenge the browser signed, read from clientDataJSON (verified again by the library). */
export function challengeFromResponse(response: { response: { clientDataJSON: string } }): string | null {
  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(response.response.clientDataJSON))) as { challenge?: unknown };
    return typeof data.challenge === "string" && data.challenge.length > 0 && data.challenge.length <= 512 ? data.challenge : null;
  } catch {
    return null;
  }
}

async function storeChallenge(db: Db, challenge: string, kind: "register" | "login", userId: number | null, now = Date.now()) {
  await db.batch([
    db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, now)),
    db.insert(webauthnChallenges).values({ challenge, kind, userId, expiresAt: now + CHALLENGE_TTL_MS }),
  ]);
}

/** Deletes and returns the challenge if it exists, matches, and hasn't expired (single use). */
export async function consumeChallenge(
  db: Db,
  challenge: string,
  kind: "register" | "login",
  userId: number | null,
  now = Date.now(),
): Promise<boolean> {
  const conds = [eq(webauthnChallenges.challenge, challenge), eq(webauthnChallenges.kind, kind), gt(webauthnChallenges.expiresAt, now)];
  if (userId != null) conds.push(eq(webauthnChallenges.userId, userId));
  const row = await db.delete(webauthnChallenges).where(and(...conds)).returning({ c: webauthnChallenges.challenge }).get();
  return Boolean(row);
}

function userIdBytes(userId: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`gift-list-user-${userId}`) as Uint8Array<ArrayBuffer>;
}

// ---------------------------------------------------------------- public routes (login)

export const passkeyPublicRoutes = new Hono<AppEnv>();

passkeyPublicRoutes.post("/login/options", async (c) => {
  const db = c.var.db;
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await takeRateLimit(db, `passkey-options:${ip}`, PASSKEY_OPTIONS_MAX_PER_MINUTE, 60_000))) {
    c.header("Retry-After", "60");
    fail(429, "Too many requests. Try again in a minute.");
  }
  const { rpID } = rpFor(c.req.raw);
  // Discoverable credentials: no allowCredentials, so the browser offers every passkey for this site.
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required", timeout: CHALLENGE_TTL_MS });
  await storeChallenge(db, options.challenge, "login", null);
  return c.json(options);
});

passkeyPublicRoutes.post("/login/verify", async (c) => {
  const { response } = await parseJson(c, passkeyLoginVerifyBody);
  const db = c.var.db;
  const now = Date.now();
  const ipKeys = loginKeys(c.req.raw);
  await checkLoginRateLimit(c, ipKeys, now);

  const reject = async (keys: string[]): Promise<never> => {
    await recordLoginFailure(c, keys, now);
    fail(401, "Passkey sign-in failed");
  };

  const challenge = challengeFromResponse(response);
  if (!challenge || !(await consumeChallenge(db, challenge, "login", null, now))) return reject(ipKeys);

  const passkey = await db.select().from(passkeys).where(eq(passkeys.credentialId, response.id)).get();
  if (!passkey) return reject(ipKeys);
  const user = await db.select().from(users).where(eq(users.id, passkey.userId)).get();
  if (!user) return reject(ipKeys);
  const keys = loginKeys(c.req.raw, user.email);

  const { rpID, origins } = rpFor(c.req.raw);
  let newCounter: number;
  try {
    const result = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: fromBase64Url(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: true,
    });
    if (!result.verified) return reject(keys);
    newCounter = result.authenticationInfo.newCounter;
  } catch {
    return reject(keys);
  }

  await db
    .update(passkeys)
    .set({ counter: newCounter, lastUsedAt: new Date(now).toISOString() })
    .where(eq(passkeys.id, passkey.id));
  await startSession(c, user, keys, now);
  return c.json({ user: toApiUser(user) });
});

// ---------------------------------------------------------------- signed-in routes

export const passkeySessionRoutes = new Hono<AppEnv>();

passkeySessionRoutes.post("/passkey/register/options", async (c) => {
  const db = c.var.db;
  const user = c.var.user;
  const { rpID } = rpFor(c.req.raw);
  const existing = await db
    .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, user.id))
    .all();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.email,
    userDisplayName: user.displayName,
    userID: userIdBytes(user.id),
    attestationType: "none",
    timeout: CHALLENGE_TTL_MS,
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  await storeChallenge(db, options.challenge, "register", user.id);
  return c.json(options);
});

passkeySessionRoutes.post("/passkey/register/verify", async (c) => {
  const { response, name } = await parseJson(c, passkeyRegisterVerifyBody);
  const db = c.var.db;
  const user = c.var.user;
  const challenge = challengeFromResponse(response);
  if (!challenge || !(await consumeChallenge(db, challenge, "register", user.id))) {
    fail(400, "This passkey request has expired. Please try again.");
  }
  const { rpID, origins } = rpFor(c.req.raw);
  let result: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    result = await verifyRegistrationResponse({
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch {
    fail(400, "Passkey could not be verified");
  }
  if (!result.verified) fail(400, "Passkey could not be verified");
  const info = result.registrationInfo;
  const taken = await db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.credentialId, info.credential.id)).get();
  if (taken) fail(409, "This passkey is already registered");
  await db.insert(passkeys).values({
    userId: user.id,
    credentialId: info.credential.id,
    publicKey: base64Url(info.credential.publicKey),
    counter: info.credential.counter,
    transports: info.credential.transports ?? [],
    name: name || "Passkey",
    createdAt: new Date().toISOString(),
  });
  return c.json({ ok: true });
});

passkeySessionRoutes.get("/passkeys", async (c) => {
  const rows = await c.var.db
    .select({ id: passkeys.id, name: passkeys.name, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt })
    .from(passkeys)
    .where(eq(passkeys.userId, c.var.user.id))
    .orderBy(asc(passkeys.createdAt), asc(passkeys.id))
    .all();
  return c.json(rows satisfies ApiPasskey[]);
});

passkeySessionRoutes.delete("/passkeys/:id", async (c: Context<AppEnv>) => {
  const id = idParam(c);
  const row = await c.var.db
    .delete(passkeys)
    .where(and(eq(passkeys.id, id), eq(passkeys.userId, c.var.user.id)))
    .returning({ id: passkeys.id })
    .get();
  if (!row) notFound("Passkey not found");
  return c.json({ ok: true });
});
