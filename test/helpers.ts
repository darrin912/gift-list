import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { createApp } from "../src/worker/app";
import { hashPassword } from "../src/worker/crypto";

export const app = createApp();
let counter = 0;
/** Distinguishes test files in case they share storage. */
const run = Math.random().toString(36).slice(2, 8);

export function nextN(): number {
  return ++counter;
}

export async function call(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string; ip?: string } = {},
): Promise<{ status: number; body: any; headers: Headers; text: string }> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (init.cookie) headers.set("Cookie", init.cookie);
  headers.set("CF-Connecting-IP", init.ip ?? "203.0.113.1");
  const res = await app.fetch(
    new Request(`https://gifts.example/api${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    env,
  );
  const text = await res.text();
  let body: any = null;
  if (text && (res.headers.get("Content-Type") ?? "").includes("json")) body = JSON.parse(text);
  return { status: res.status, body, headers: res.headers, text };
}

/** Creates a parent person + linked user directly in D1 (like scripts/create-user.mjs) and logs in. */
export async function makeUser(name: string): Promise<{ cookie: string; personId: number; userId: number; email: string; personName: string }> {
  const n = nextN();
  const email = `${name.toLowerCase()}${n}-${run}@example.com`;
  const h = await hashPassword("password1234", 1000); // low iterations keep tests fast
  const personName = `${name}${n}`;
  const person = await env.DB.prepare("INSERT INTO people (name, kind) VALUES (?, 'parent') RETURNING id")
    .bind(personName)
    .first<{ id: number }>();
  const user = await env.DB.prepare(
    "INSERT INTO users (email, display_name, password_hash, password_salt, password_iterations, person_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(email, name, h.hash, h.salt, h.iterations, person!.id)
    .first<{ id: number }>();
  const res = await call("/auth/login", {
    method: "POST",
    body: { email: email.toUpperCase(), password: "password1234" },
    ip: `198.51.100.${n % 250}`,
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("Set-Cookie")!;
  return { cookie: setCookie.split(";")[0]!, personId: person!.id, userId: user!.id, email, personName };
}
