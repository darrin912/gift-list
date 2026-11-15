// Password hashing and token helpers. Pure WebCrypto, so the same code runs in
// Workers and in Node (scripts/create-user.mjs mirrors these exact parameters).

/** PBKDF2 iteration count for new hashes. 100k is the maximum Workers' WebCrypto allows. */
export const DEFAULT_PBKDF2_ITERATIONS = 100_000;
export const SALT_BYTES = 16;
export const HASH_BITS = 256;

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const b of arr) out += b.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error("Invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** Constant-time comparison of two equal-length strings (lengths are not secret here). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(digest);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    HASH_BITS,
  );
  return toHex(bits);
}

export interface PasswordHash {
  hash: string; // hex
  salt: string; // hex
  iterations: number;
}

export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<PasswordHash> {
  const salt = randomBytes(SALT_BYTES);
  return { hash: await pbkdf2(password, salt, iterations), salt: toHex(salt), iterations };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const computed = await pbkdf2(password, fromHex(stored.salt), stored.iterations);
  return timingSafeEqual(computed, stored.hash.toLowerCase());
}

/** A new random session token (32 bytes, base64url) plus its sha256 hex, which is what's stored. */
export async function newSessionToken(): Promise<{ token: string; id: string }> {
  const token = base64Url(randomBytes(32));
  return { token, id: await sha256Hex(token) };
}
