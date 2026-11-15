import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "../db/schema";

export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
}

/** The signed-in user, as returned by the API. */
export interface ApiUser {
  id: number;
  email: string;
  displayName: string;
  personId: number | null;
}

export interface Variables {
  db: DrizzleD1Database<typeof schema>;
  user: ApiUser;
  sessionId: string;
  /** Today's date (YYYY-MM-DD, UTC) for this request. */
  today: string;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };
