// Drizzle schema. The source of truth for the database is migrations/*.sql
// (applied with `wrangler d1 migrations apply`); keep this file in sync with them.
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const PERSON_KINDS = ["parent", "kid", "other"] as const;
export const SEASON_KINDS = ["christmas", "birthday", "anniversary", "other"] as const;
export const GIFT_CATEGORIES = ["main", "stocking", "experience", "clothing", "book", "other"] as const;
export const GIFT_STATUSES = ["idea", "planned", "ordered", "received", "wrapped", "given", "returned"] as const;
export const ACTIVITY_ACTIONS = ["create", "update", "delete"] as const;

export type PersonKind = (typeof PERSON_KINDS)[number];
export type SeasonKind = (typeof SEASON_KINDS)[number];
export type GiftCategory = (typeof GIFT_CATEGORIES)[number];
export type GiftStatus = (typeof GIFT_STATUSES)[number];

export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind", { enum: PERSON_KINDS }).notNull(),
  color: text("color").notNull().default(""),
  emoji: text("emoji").notNull().default(""),
  birthday: text("birthday"),
  sizes: text("sizes", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  likes: text("likes").notNull().default(""),
  dislikes: text("dislikes").notNull().default(""),
  notes: text("notes").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  /** A gift tag like Santa: can be a giver, never a recipient. */
  giverOnly: integer("giver_only", { mode: "boolean" }).notNull().default(false),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull().default(100000),
  personId: integer("person_id").references(() => people.id),
  createdAt: text("created_at").notNull().default(nowIso),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 hex of the cookie token
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(nowIso),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    key: text("key").notNull(), // "email:<email>" or "ip:<ip>"
    at: integer("at").notNull(), // epoch ms
  },
  (t) => [index("login_attempts_key_at_idx").on(t.key, t.at)],
);

export const seasons = sqliteTable("seasons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: SEASON_KINDS }).notNull(),
  name: text("name").notNull(),
  date: text("date").notNull(),
  overallBudgetCents: integer("overall_budget_cents").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  /** Birthday (required) / anniversary / other (optional): who the season is for. */
  honoreeId: integer("honoree_person_id").references(() => people.id),
});

export const personBudgets = sqliteTable(
  "person_budgets",
  {
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    budgetCents: integer("budget_cents").notNull().default(0),
    stockingBudgetCents: integer("stocking_budget_cents").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.personId] })],
);

export const gifts = sqliteTable(
  "gifts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonId: integer("season_id").references(() => seasons.id, { onDelete: "set null" }),
    recipientId: integer("recipient_id")
      .notNull()
      .references(() => people.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    url: text("url").notNull().default(""),
    imageUrl: text("image_url").notNull().default(""),
    category: text("category", { enum: GIFT_CATEGORIES }).notNull().default("main"),
    status: text("status", { enum: GIFT_STATUSES }).notNull().default("idea"),
    wished: integer("wished", { mode: "boolean" }).notNull().default(false),
    priority: integer("priority").notNull().default(2),
    estPriceCents: integer("est_price_cents"),
    actualPriceCents: integer("actual_price_cents"),
    store: text("store").notNull().default(""),
    orderNumber: text("order_number").notNull().default(""),
    trackingUrl: text("tracking_url").notNull().default(""),
    returnBy: text("return_by"),
    watchPrice: integer("watch_price", { mode: "boolean" }).notNull().default(false),
    lastSeenPriceCents: integer("last_seen_price_cents"),
    lowestSeenPriceCents: integer("lowest_seen_price_cents"),
    lastCheckedAt: text("last_checked_at"),
    priceDroppedAt: text("price_dropped_at"),
    createdBy: integer("created_by").references(() => users.id),
    updatedBy: integer("updated_by").references(() => users.id),
    createdAt: text("created_at").notNull().default(nowIso),
    updatedAt: text("updated_at").notNull().default(nowIso),
  },
  (t) => [
    index("gifts_season_id_idx").on(t.seasonId),
    index("gifts_recipient_id_idx").on(t.recipientId),
    index("gifts_price_watch_idx").on(t.watchPrice, t.lastCheckedAt),
  ],
);

export const giftGivers = sqliteTable(
  "gift_givers",
  {
    giftId: integer("gift_id")
      .notNull()
      .references(() => gifts.id, { onDelete: "cascade" }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id),
  },
  (t) => [primaryKey({ columns: [t.giftId, t.personId] }), index("gift_givers_person_id_idx").on(t.personId)],
);

export const activityLog = sqliteTable(
  "activity_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => users.id),
    giftId: integer("gift_id"), // not an FK: rows outlive deleted gifts
    recipientId: integer("recipient_id"),
    seasonId: integer("season_id"),
    action: text("action", { enum: ACTIVITY_ACTIONS }).notNull(),
    summary: text("summary").notNull(),
    /** Set for rows written by the system rather than a user, e.g. "price-watch". */
    systemActor: text("system_actor"),
    at: text("at").notNull().default(nowIso),
  },
  (t) => [index("activity_log_at_idx").on(t.at), index("activity_log_season_id_idx").on(t.seasonId, t.id)],
);

export const rateLimitEvents = sqliteTable(
  "rate_limit_events",
  {
    key: text("key").notNull(), // e.g. "link-preview:<userId>"
    at: integer("at").notNull(), // epoch ms
  },
  (t) => [index("rate_limit_events_key_at_idx").on(t.key, t.at)],
);

export const exchangeDraws = sqliteTable(
  "exchange_draws",
  {
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    giverId: integer("giver_person_id")
      .notNull()
      .references(() => people.id),
    recipientId: integer("recipient_person_id")
      .notNull()
      .references(() => people.id),
    createdAt: text("created_at").notNull().default(nowIso),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.giverId] }), index("exchange_draws_recipient_idx").on(t.recipientId)],
);

export const passkeys = sqliteTable(
  "passkeys",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(), // base64url
    publicKey: text("public_key").notNull(), // base64url COSE key
    counter: integer("counter").notNull().default(0),
    transports: text("transports", { mode: "json" }).$type<string[]>().notNull().default([]),
    name: text("name").notNull().default(""),
    createdAt: text("created_at").notNull().default(nowIso),
    lastUsedAt: text("last_used_at"),
  },
  (t) => [index("passkeys_user_id_idx").on(t.userId)],
);

export const WEBAUTHN_CHALLENGE_KINDS = ["register", "login"] as const;

export const webauthnChallenges = sqliteTable(
  "webauthn_challenges",
  {
    challenge: text("challenge").primaryKey(),
    kind: text("kind", { enum: WEBAUTHN_CHALLENGE_KINDS }).notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(), // epoch ms
  },
  (t) => [index("webauthn_challenges_expires_idx").on(t.expiresAt)],
);

export type PersonRow = typeof people.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SeasonRow = typeof seasons.$inferSelect;
export type GiftRow = typeof gifts.$inferSelect;
