// Passkeys, end to end against @simplewebauthn/server running in the Workers pool, with a
// small software authenticator (ES256, "none" attestation) built on WebCrypto.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { challengeFromResponse, rpFor } from "../src/worker/passkeys";
import { call, makeUser } from "./helpers";

const ORIGIN = "https://gifts.example";
const RP_ID = "gifts.example";

// ---------------------------------------------------------------- tiny CBOR encoder

function cborHead(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 0x100) return [(major << 5) | 24, n];
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
  return [(major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function cbor(v: Cbor): number[] {
  if (typeof v === "number") return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  if (typeof v === "string") {
    const b = new TextEncoder().encode(v);
    return [...cborHead(3, b.length), ...b];
  }
  if (v instanceof Uint8Array) return [...cborHead(2, v.length), ...v];
  const out = cborHead(5, v.size);
  for (const [k, val] of v) out.push(...cbor(k), ...cbor(val));
  return out;
}

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (ch) => ch.charCodeAt(0));
const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);

/** Raw r||s (WebCrypto) -> ASN.1 DER (WebAuthn). */
function derSignature(raw: Uint8Array): Uint8Array {
  const int = (x: Uint8Array) => {
    let i = 0;
    while (i < x.length - 1 && x[i] === 0) i++;
    let v = x.slice(i);
    if (v[0]! & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

class SoftAuthenticator {
  credentialId = crypto.getRandomValues(new Uint8Array(16));
  signCount = 0;
  private keys!: CryptoKeyPair;

  async init() {
    this.keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    return this;
  }

  get id() {
    return b64u(this.credentialId);
  }

  async register(options: { challenge: string }, opts: { origin?: string; rpId?: string; uv?: boolean } = {}) {
    const jwk = (await crypto.subtle.exportKey("jwk", this.keys.publicKey)) as JsonWebKey;
    const cose = new Uint8Array(cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, fromB64u(jwk.x!)], [-3, fromB64u(jwk.y!)]])));
    const flags = 0x01 | (opts.uv === false ? 0 : 0x04) | 0x40;
    const authData = concat(
      await sha256(new TextEncoder().encode(opts.rpId ?? RP_ID)),
      new Uint8Array([flags]),
      u32(this.signCount),
      new Uint8Array(16),
      new Uint8Array([0, this.credentialId.length]),
      this.credentialId,
      cose,
    );
    const attestationObject = new Uint8Array(cbor(new Map<Cbor, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]])));
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: opts.origin ?? ORIGIN, crossOrigin: false }));
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ["internal"] },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  async assert(options: { challenge: string }, opts: { origin?: string; signCount?: number } = {}) {
    this.signCount = opts.signCount ?? this.signCount + 1;
    const authData = concat(await sha256(new TextEncoder().encode(RP_ID)), new Uint8Array([0x05]), u32(this.signCount));
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: opts.origin ?? ORIGIN, crossOrigin: false }));
    const signed = concat(authData, await sha256(clientDataJSON));
    const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, signed));
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(derSignature(raw)), userHandle: "" },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}

let ipN = 0;
const freshIp = () => `192.0.2.${(++ipN % 250) + 1}`;

async function registerPasskey(user: { cookie: string }, auth: SoftAuthenticator, name = "iPhone") {
  const options = (await call("/auth/passkey/register/options", { method: "POST", cookie: user.cookie })).body;
  const res = await call("/auth/passkey/register/verify", { method: "POST", cookie: user.cookie, body: { response: await auth.register(options), name } });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
}

describe("passkey registration", () => {
  it("returns options for the request's RP and stores the passkey", async () => {
    const mom = await makeUser("Mom");
    const res = await call("/auth/passkey/register/options", { method: "POST", cookie: mom.cookie });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      challenge: expect.any(String),
      rp: { name: "Gift List", id: RP_ID },
      user: { name: mom.email, displayName: "Mom", id: expect.any(String) },
      attestation: "none",
      excludeCredentials: [],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    expect(res.body.pubKeyCredParams.map((p: any) => p.alg)).toContain(-7);
    const stored = await env.DB.prepare("SELECT kind, user_id, expires_at FROM webauthn_challenges WHERE challenge = ?").bind(res.body.challenge).first<any>();
    expect(stored).toMatchObject({ kind: "register", user_id: mom.userId });
    expect(stored.expires_at - Date.now()).toBeGreaterThan(4 * 60 * 1000);
    expect(stored.expires_at - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);

    const auth = await new SoftAuthenticator().init();
    const verify = await call("/auth/passkey/register/verify", { method: "POST", cookie: mom.cookie, body: { response: await auth.register(res.body), name: "iPhone" } });
    expect(verify.status).toBe(200);
    const list = (await call("/auth/passkeys", { cookie: mom.cookie })).body;
    expect(list).toEqual([{ id: expect.any(Number), name: "iPhone", createdAt: expect.any(String), lastUsedAt: null }]);
    // Now excluded from new registrations.
    const again = (await call("/auth/passkey/register/options", { method: "POST", cookie: mom.cookie })).body;
    expect(again.excludeCredentials).toEqual([{ id: auth.id, type: "public-key", transports: ["internal"] }]);
    // Registering the same credential again is a conflict.
    const dup = await call("/auth/passkey/register/verify", { method: "POST", cookie: mom.cookie, body: { response: await auth.register(again), name: "x" } });
    expect(dup.status).toBe(409);
  });

  it("rejects: no session, reused/expired/foreign challenge, wrong origin or RP, no user verification, bad body", async () => {
    const mom = await makeUser("Mom");
    const dad = await makeUser("Dad");
    expect((await call("/auth/passkey/register/options", { method: "POST" })).status).toBe(401);
    expect((await call("/auth/passkeys")).status).toBe(401);
    const auth = await new SoftAuthenticator().init();
    const opts = async (who = mom) => (await call("/auth/passkey/register/options", { method: "POST", cookie: who.cookie })).body;
    const verify = async (response: unknown, who = mom) => call("/auth/passkey/register/verify", { method: "POST", cookie: who.cookie, body: { response, name: "Key" } });

    // Wrong origin; the challenge is consumed even so (single use).
    const o1 = await opts();
    expect((await verify(await auth.register(o1, { origin: "https://evil.example" }))).status).toBe(400);
    expect((await verify(await auth.register(o1))).status).toBe(400);
    // Wrong RP ID hash.
    expect((await verify(await auth.register(await opts(), { rpId: "evil.example" }))).status).toBe(400);
    // User verification is required.
    expect((await verify(await auth.register(await opts(), { uv: false }))).status).toBe(400);
    // Another user's challenge.
    expect((await verify(await auth.register(await opts(dad)))).status).toBe(400);
    // Expired challenge.
    const o2 = await opts();
    await env.DB.prepare("UPDATE webauthn_challenges SET expires_at = ? WHERE challenge = ?").bind(Date.now() - 1, o2.challenge).run();
    expect((await verify(await auth.register(o2))).status).toBe(400);
    // Made-up challenge and malformed bodies.
    expect((await verify(await auth.register({ challenge: "bm90LWEtcmVhbC1jaGFsbGVuZ2U" }))).status).toBe(400);
    expect((await verify({ id: "x" })).status).toBe(400);
    expect((await call("/auth/passkey/register/verify", { method: "POST", cookie: mom.cookie, body: { response: { id: "a", rawId: "a", type: "public-key", response: { clientDataJSON: "!!!" } } } })).status).toBe(400);

    expect((await call("/auth/passkeys", { cookie: mom.cookie })).body).toEqual([]);
  });
});

describe("passkey login", () => {
  it("signs in with a discoverable credential, sets the session cookie and updates the counter", async () => {
    const mom = await makeUser("Mom");
    const auth = await new SoftAuthenticator().init();
    await registerPasskey(mom, auth);

    const options = await call("/auth/passkey/login/options", { method: "POST", ip: freshIp() });
    expect(options.status).toBe(200);
    expect(options.body).toMatchObject({ challenge: expect.any(String), rpId: RP_ID, userVerification: "required" });
    expect(options.body.allowCredentials ?? []).toEqual([]);

    const ip = freshIp();
    const res = await call("/auth/passkey/login/verify", { method: "POST", body: { response: await auth.assert(options.body) }, ip });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: mom.userId, email: mom.email, displayName: "Mom", personId: mom.personId });
    const setCookie = res.headers.get("Set-Cookie")!;
    expect(setCookie).toMatch(/^gl_session=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    const cookie = setCookie.split(";")[0]!;
    expect((await call("/auth/me", { cookie })).body.user.id).toBe(mom.userId);

    const row = await env.DB.prepare("SELECT counter, last_used_at FROM passkeys WHERE credential_id = ?").bind(auth.id).first<any>();
    expect(row.counter).toBe(1);
    expect(row.last_used_at).not.toBeNull();
    expect((await call("/auth/passkeys", { cookie })).body[0].lastUsedAt).toEqual(expect.any(String));

    // Replaying the same assertion: the challenge is gone.
    const replay = await call("/auth/passkey/login/verify", { method: "POST", body: { response: await auth.assert(options.body, { signCount: 2 }) }, ip });
    expect(replay.status).toBe(401);
    // A cloned authenticator (counter went backwards) is refused.
    const o2 = (await call("/auth/passkey/login/options", { method: "POST", ip })).body;
    expect((await call("/auth/passkey/login/verify", { method: "POST", body: { response: await auth.assert(o2, { signCount: 1 }) }, ip })).status).toBe(401);
    // And a good one still works.
    const o3 = (await call("/auth/passkey/login/options", { method: "POST", ip })).body;
    expect((await call("/auth/passkey/login/verify", { method: "POST", body: { response: await auth.assert(o3, { signCount: 5 }) }, ip })).status).toBe(200);
    expect((await env.DB.prepare("SELECT counter FROM passkeys WHERE credential_id = ?").bind(auth.id).first<any>()).counter).toBe(5);
  });

  it("rejects unknown credentials, bad signatures, wrong origin and expired challenges, and counts toward the login rate limit", async () => {
    const dad = await makeUser("Dad");
    const auth = await new SoftAuthenticator().init();
    await registerPasskey(dad, auth);
    const ip = freshIp();
    const options = async () => (await call("/auth/passkey/login/options", { method: "POST", ip: freshIp() })).body;
    const verify = (response: unknown) => call("/auth/passkey/login/verify", { method: "POST", body: { response }, ip });

    const stranger = await new SoftAuthenticator().init(); // never registered
    expect((await verify(await stranger.assert(await options()))).status).toBe(401);
    expect((await verify(await auth.assert(await options(), { origin: "https://evil.example" }))).status).toBe(401);
    const tampered = await auth.assert(await options());
    tampered.response.signature = b64u(derSignature(crypto.getRandomValues(new Uint8Array(64))));
    expect((await verify(tampered)).status).toBe(401);
    const expired = await options();
    await env.DB.prepare("UPDATE webauthn_challenges SET expires_at = ? WHERE challenge = ?").bind(Date.now() - 1, expired.challenge).run();
    expect((await verify(await auth.assert(expired))).status).toBe(401);
    // A registration challenge can't be used to log in.
    const reg = (await call("/auth/passkey/register/options", { method: "POST", cookie: dad.cookie })).body;
    expect((await verify(await auth.assert(reg))).status).toBe(401);

    // That's 5 failures from this IP: now even a valid passkey (and the password) is rate-limited.
    const good = await verify(await auth.assert(await options()));
    expect(good.status).toBe(429);
    expect(good.headers.get("Retry-After")).toBe("900");
    expect((await call("/auth/login", { method: "POST", body: { email: dad.email, password: "password1234" }, ip })).status).toBe(429);
    // Malformed body is a 400.
    expect((await call("/auth/passkey/login/verify", { method: "POST", body: {}, ip: freshIp() })).status).toBe(400);
  });

  it("rate-limits login options per IP", async () => {
    const ip = "192.0.2.254";
    for (let i = 0; i < 20; i++) expect((await call("/auth/passkey/login/options", { method: "POST", ip })).status).toBe(200);
    expect((await call("/auth/passkey/login/options", { method: "POST", ip })).status).toBe(429);
  });
});

describe("passkey list and delete", () => {
  it("lists only your own passkeys and deletes them", async () => {
    const mom = await makeUser("Mom");
    const dad = await makeUser("Dad");
    await registerPasskey(mom, await new SoftAuthenticator().init(), "iPhone");
    await registerPasskey(mom, await new SoftAuthenticator().init(), "MacBook");
    const list = (await call("/auth/passkeys", { cookie: mom.cookie })).body;
    expect(list.map((p: any) => p.name)).toEqual(["iPhone", "MacBook"]);
    expect((await call("/auth/passkeys", { cookie: dad.cookie })).body).toEqual([]);
    expect((await call(`/auth/passkeys/${list[0].id}`, { method: "DELETE", cookie: dad.cookie })).status).toBe(404);
    expect((await call(`/auth/passkeys/${list[0].id}`, { method: "DELETE", cookie: mom.cookie })).body).toEqual({ ok: true });
    expect((await call(`/auth/passkeys/${list[0].id}`, { method: "DELETE", cookie: mom.cookie })).status).toBe(404);
    expect((await call("/auth/passkeys", { cookie: mom.cookie })).body.map((p: any) => p.name)).toEqual(["MacBook"]);
  });
});

describe("passkey helpers", () => {
  it("derives the RP from the request and only trusts a localhost Origin in dev", () => {
    expect(rpFor(new Request("https://gifts.example/api/x", { headers: { Origin: "http://localhost:5173" } }))).toEqual({ rpID: "gifts.example", origins: ["https://gifts.example"] });
    expect(rpFor(new Request("http://localhost:8787/api/x", { headers: { Origin: "http://localhost:5173" } }))).toEqual({
      rpID: "localhost",
      origins: ["http://localhost:8787", "http://localhost:5173"],
    });
    expect(rpFor(new Request("http://localhost:8787/api/x", { headers: { Origin: "https://evil.example" } })).origins).toEqual(["http://localhost:8787"]);
  });

  it("reads the challenge from clientDataJSON", () => {
    const cd = b64u(new TextEncoder().encode(JSON.stringify({ challenge: "abc" })));
    expect(challengeFromResponse({ response: { clientDataJSON: cd } })).toBe("abc");
    expect(challengeFromResponse({ response: { clientDataJSON: "%%%" } })).toBeNull();
    expect(challengeFromResponse({ response: { clientDataJSON: b64u(new TextEncoder().encode("{}")) } })).toBeNull();
  });
});
