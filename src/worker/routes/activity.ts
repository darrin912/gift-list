import { Hono } from "hono";
import { loadActivity } from "../activity";
import { parseQuery } from "../http";
import type { AppEnv } from "../types";
import { activityQuery } from "../validation";

export const activityRoutes = new Hono<AppEnv>();

activityRoutes.get("/", async (c) => {
  const { limit, seasonId } = parseQuery(c, activityQuery);
  return c.json(await loadActivity(c.var.db, c.var.user, c.var.today, { limit: limit ?? 30, seasonId }));
});
