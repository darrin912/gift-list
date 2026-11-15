import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { createApp } from "./app";
import { runPriceWatch } from "./price-watch";
import type { Bindings } from "./types";

const app = createApp();

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  /** Cron Trigger ("17 13 * * *" in wrangler.jsonc): the daily price-drop watch. */
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(
      runPriceWatch(drizzle(env.DB, { schema })).then(
        (r) => console.log(`price watch: checked ${r.checked}, dropped ${r.dropped}`),
        (err) => console.error("price watch failed", err),
      ),
    );
  },
} satisfies ExportedHandler<Bindings>;
