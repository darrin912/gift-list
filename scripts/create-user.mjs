#!/usr/bin/env node
// Creates a login (and its linked "parent" person), or resets a password.
//
//   npm run user:create                      # local D1 (default)
//   npm run user:create -- --remote          # production D1
//   npm run user:create -- --reset-password  # change the password for an existing email
//
// Hashing parameters MUST match src/worker/crypto.ts:
// PBKDF2-SHA256, 16-byte random salt (hex), 32-byte derived key (hex), 100000 iterations.
// No dependencies beyond Node built-ins; the SQL is run with `npx wrangler d1 execute`.

import { spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import readline from "node:readline";

const DB_NAME = "gift-list";
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const MIN_PASSWORD = 10;

const args = process.argv.slice(2);
const known = new Set(["--local", "--remote", "--reset-password", "--help", "-h"]);
for (const a of args) {
  if (!known.has(a)) {
    console.error(`Unknown option: ${a}`);
    process.exit(2);
  }
}
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node scripts/create-user.mjs [--local|--remote] [--reset-password]");
  process.exit(0);
}
if (args.includes("--local") && args.includes("--remote")) {
  console.error("Choose either --local or --remote, not both.");
  process.exit(2);
}
const target = args.includes("--remote") ? "--remote" : "--local";
const resetPassword = args.includes("--reset-password");

const toHex = (buf) => Buffer.from(buf).toString("hex");

async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    key,
    HASH_BITS,
  );
  return { hash: toHex(bits), salt: toHex(salt), iterations: ITERATIONS };
}

/** SQL string literal: wrap in single quotes, double any embedded single quotes. */
function sqlString(value) {
  const s = String(value);
  if (s.includes("\0")) throw new Error("NUL characters are not allowed");
  return `'${s.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------- prompts

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let muted = false;
// Don't echo typed characters while entering a password (TTY only).
const origWrite = rl._writeToOutput?.bind(rl);
if (origWrite) {
  rl._writeToOutput = (str) => {
    if (!muted) origWrite(str);
    else if (str.includes("\n") || str.includes("\r")) origWrite("\n");
  };
}

// Buffer piped stdin lines so non-interactive use (e.g. CI or tests) works too.
const lines = [];
const waiters = [];
rl.on("line", (line) => {
  const w = waiters.shift();
  if (w) w(line);
  else lines.push(line);
});
rl.on("close", () => {
  for (const w of waiters.splice(0)) w(null);
});

function ask(question, { hidden = false } = {}) {
  process.stdout.write(question);
  muted = hidden && process.stdin.isTTY;
  return new Promise((resolve) => {
    const done = (line) => {
      muted = false;
      if (line === null) {
        console.error("\nInput ended.");
        process.exit(1);
      }
      if (!process.stdin.isTTY) process.stdout.write("\n");
      resolve(line);
    };
    if (lines.length) done(lines.shift());
    else waiters.push(done);
  });
}

// ---------------------------------------------------------------- main

function wrangler(sql, { json = false } = {}) {
  const cmd = ["wrangler", "d1", "execute", DB_NAME, target, "--command", sql];
  if (json) cmd.push("--json");
  const res = spawnSync("npx", cmd, {
    stdio: ["ignore", json ? "pipe" : "inherit", "inherit"],
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    if (json && res.stdout) console.error(res.stdout);
    console.error(`\nwrangler d1 execute failed (exit ${res.status}).`);
    process.exit(res.status ?? 1);
  }
  return res.stdout;
}

/** Number of users with this email (0 or 1). */
function countUsers(email) {
  const out = wrangler(`SELECT count(*) AS n FROM users WHERE email = ${sqlString(email)};`, { json: true });
  const start = out.indexOf("[");
  const parsed = JSON.parse(out.slice(start));
  return Number(parsed[0]?.results?.[0]?.n ?? 0);
}

function validEmail(email) {
  return email.length <= 320 && /^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/.test(email);
}

async function main() {
  console.log(`${resetPassword ? "Reset a password" : "Create a user"} in the ${target.slice(2)} D1 database "${DB_NAME}".\n`);

  const email = (await ask("Email: ")).trim().toLowerCase();
  if (!validEmail(email)) throw new Error("That doesn't look like an email address.");

  let displayName = "";
  if (!resetPassword) {
    displayName = (await ask("Display name: ")).trim();
    if (displayName.length < 1 || displayName.length > 100) throw new Error("Display name must be 1-100 characters.");
  }

  const password = await ask(`Password (min ${MIN_PASSWORD} characters): `, { hidden: true });
  if (password.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`);
  if (password.length > 1024) throw new Error("Password is too long.");
  const confirm = await ask("Confirm password: ", { hidden: true });
  if (confirm !== password) throw new Error("Passwords don't match.");
  rl.close();

  const existing = countUsers(email);
  if (resetPassword && existing === 0) throw new Error(`No user has the email ${email}.`);
  if (!resetPassword && existing > 0) throw new Error(`A user with the email ${email} already exists. Use --reset-password to change it.`);

  const h = await hashPassword(password);
  const e = sqlString(email);
  let sql;
  if (resetPassword) {
    // Also signs that user out everywhere.
    sql =
      `UPDATE users SET password_hash = ${sqlString(h.hash)}, password_salt = ${sqlString(h.salt)}, ` +
      `password_iterations = ${h.iterations} WHERE email = ${e}; ` +
      `DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ${e});`;
  } else {
    // Insert the parent person, then the user linked to it (people.id is AUTOINCREMENT,
    // so the newest matching row is the one just inserted).
    const n = sqlString(displayName);
    sql =
      `INSERT INTO people (name, kind) VALUES (${n}, 'parent'); ` +
      `INSERT INTO users (email, display_name, password_hash, password_salt, password_iterations, person_id) ` +
      `VALUES (${e}, ${n}, ${sqlString(h.hash)}, ${sqlString(h.salt)}, ${h.iterations}, ` +
      `(SELECT max(id) FROM people WHERE name = ${n} AND kind = 'parent'));`;
  }

  console.log(`\nRunning wrangler d1 execute ${DB_NAME} ${target} ...`);
  wrangler(sql);
  console.log(
    resetPassword
      ? `\nPassword reset for ${email}; existing sessions were signed out.`
      : `\nCreated ${email} (${displayName}) with a linked parent person.`,
  );
}

main().catch((err) => {
  rl.close();
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
