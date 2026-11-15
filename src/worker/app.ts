import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import * as schema from "../db/schema";
import { authRoutes, authSessionRoutes, requireSession } from "./auth";
import { dashboardRoutes } from "./routes/dashboard";
import { giftRoutes, listStores } from "./routes/gifts";
import { peopleRoutes } from "./routes/people";
import { seasonRoutes } from "./routes/seasons";
import { todayUtc } from "./rules";
import type { AppEnv } from "./types";

export function createApi() {
  const api = new Hono<AppEnv>();

  api.use("*", async (c, next) => {
    c.set("db", drizzle(c.env.DB, { schema }));
    c.set("today", todayUtc());
    await next();
    c.header("Cache-Control", "no-store");
  });

  // Public: only login.
  api.route("/auth", authRoutes);

  // Everything else needs a session.
  api.use("*", requireSession);
  api.route("/auth", authSessionRoutes);
  api.route("/people", peopleRoutes);
  api.route("/seasons", seasonRoutes);
  api.route("/gifts", giftRoutes);
  api.get("/stores", async (c) => c.json(await listStores(c.var.db)));
  api.route("/dashboard", dashboardRoutes);

  api.notFound((c) => c.json({ error: "Not found" }, 404));
  return api;
}

export function createApp() {
  const app = new Hono<AppEnv>();
  app.route("/api", createApi());
  // Anything that isn't /api is the React app (static assets with SPA fallback).
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      // Keep headers the handler set (e.g. Retry-After) and return the JSON error shape.
      return c.json({ error: err.message || "Error" }, err.status);
    }
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });
  return app;
}
