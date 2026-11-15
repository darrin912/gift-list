import { Hono } from "hono";
import { fail, parseJson } from "../http";
import { checkFetchUrl, fetchLinkPreview } from "../link-preview";
import { takeRateLimit } from "../rate-limit";
import type { AppEnv } from "../types";
import { linkPreviewBody } from "../validation";

export const LINK_PREVIEW_MAX_PER_MINUTE = 30;

export const linkPreviewRoutes = new Hono<AppEnv>();

linkPreviewRoutes.post("/", async (c) => {
  const { url } = await parseJson(c, linkPreviewBody);
  const check = checkFetchUrl(url);
  if (!check.ok) fail(400, check.reason);
  const allowed = await takeRateLimit(c.var.db, `link-preview:${c.var.user.id}`, LINK_PREVIEW_MAX_PER_MINUTE, 60_000);
  if (!allowed) {
    c.header("Retry-After", "60");
    fail(429, "Too many link previews. Try again in a minute.");
  }
  return c.json(await fetchLinkPreview(check.url));
});
