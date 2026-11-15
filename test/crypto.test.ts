import { describe, expect, it } from "vitest";
import {
  DEFAULT_PBKDF2_ITERATIONS,
  hashPassword,
  newSessionToken,
  sha256Hex,
  timingSafeEqual,
  verifyPassword,
} from "../src/worker/crypto";

describe("password hashing", () => {
  it("hashes with a random 16-byte salt and verifies", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a.iterations).toBe(DEFAULT_PBKDF2_ITERATIONS);
    expect(a.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("correct horse batterY", a)).toBe(false);
  });

  it("respects the stored iteration count", async () => {
    const h = await hashPassword("another password", 1000);
    expect(await verifyPassword("another password", h)).toBe(true);
    expect(await verifyPassword("another password", { ...h, iterations: 1001 })).toBe(false);
  });

  it("matches a known PBKDF2-SHA256 vector (same params as scripts/create-user.mjs)", async () => {
    // RFC 7914 §11 test vector: P="passwd", S="salt", c=1, dkLen=64 (we use the first 32 bytes).
    const salt = Array.from(new TextEncoder().encode("salt"), (b) => b.toString(16).padStart(2, "0")).join("");
    const expected = "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc";
    expect(await verifyPassword("passwd", { hash: expected, salt, iterations: 1 })).toBe(true);
  });

  it("constant-time compare", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("session tokens are random and stored as sha256", async () => {
    const t = await newSessionToken();
    expect(t.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t.id).toBe(await sha256Hex(t.token));
    expect((await newSessionToken()).token).not.toBe(t.token);
  });
});
