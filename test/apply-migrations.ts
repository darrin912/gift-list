import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Idempotent: only unapplied migrations run.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
