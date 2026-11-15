import { z } from "zod";
import { GIFT_CATEGORIES, GIFT_STATUSES, PERSON_KINDS, SEASON_KINDS } from "../db/schema";

const MAX_CENTS = 10_000_000_00; // $10M, a sanity cap

export const id = z.number().int().positive();
export const cents = z.number().int().min(0).max(MAX_CENTS);
export const isoDate = z.iso.date(); // YYYY-MM-DD, validated as a real date
/** Optional free text; null is accepted and stored as "". */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((s) => (s ?? "").trim());

// ---------------------------------------------------------------- auth

export const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(1).max(320),
  password: z.string().min(1).max(1024),
});

export const passwordBody = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(10, "must be at least 10 characters").max(1024),
});

// ---------------------------------------------------------------- people

const personFields = {
  name: z.string().trim().min(1).max(100),
  kind: z.enum(PERSON_KINDS),
  color: text(32),
  emoji: text(32),
  birthday: isoDate.nullable(),
  sizes: z.record(z.string().trim().min(1).max(50), z.string().max(100)).refine((r) => Object.keys(r).length <= 50, {
    message: "too many sizes",
  }),
  likes: text(5000),
  dislikes: text(5000),
  notes: text(20000),
  sortOrder: z.number().int().min(-1_000_000).max(1_000_000),
  archived: z.boolean(),
  giverOnly: z.boolean(),
};

export const personCreate = z.object({
  ...personFields,
  color: personFields.color.default(""),
  emoji: personFields.emoji.default(""),
  birthday: personFields.birthday.default(null),
  sizes: personFields.sizes.default({}),
  likes: personFields.likes.default(""),
  dislikes: personFields.dislikes.default(""),
  notes: personFields.notes.default(""),
  sortOrder: personFields.sortOrder.default(0),
  archived: personFields.archived.default(false),
  giverOnly: personFields.giverOnly.default(false),
});

export const personPatch = z.object(personFields).partial();

// ---------------------------------------------------------------- seasons

const seasonFields = {
  kind: z.enum(SEASON_KINDS),
  name: z.string().trim().min(1).max(100),
  date: isoDate,
  overallBudgetCents: cents,
  isActive: z.boolean(),
  archived: z.boolean(),
  honoreeId: id.nullable(),
};

export const seasonCreate = z.object({
  ...seasonFields,
  kind: seasonFields.kind.default("christmas"),
  overallBudgetCents: cents.default(0),
  isActive: z.boolean().default(false),
  archived: z.boolean().default(false),
  honoreeId: id.nullable().default(null),
});

export const seasonPatch = z.object(seasonFields).partial();

export const budgetPut = z.object({
  budgetCents: cents,
  stockingBudgetCents: cents.optional(),
});

// ---------------------------------------------------------------- gifts

const giftFields = {
  seasonId: id.nullable(),
  recipientId: id,
  title: z.string().trim().min(1).max(200),
  description: text(20000),
  url: text(2000),
  imageUrl: text(2000),
  category: z.enum(GIFT_CATEGORIES),
  status: z.enum(GIFT_STATUSES),
  wished: z.boolean(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  estPriceCents: cents.nullable(),
  actualPriceCents: cents.nullable(),
  store: text(200),
  orderNumber: text(200),
  trackingUrl: text(2000),
  returnBy: isoDate.nullable(),
  watchPrice: z.boolean(),
  giverIds: z
    .array(id)
    .max(20)
    .transform((ids) => [...new Set(ids)]),
};

export const giftCreate = z.object({
  ...giftFields,
  seasonId: giftFields.seasonId.default(null),
  description: giftFields.description.default(""),
  url: giftFields.url.default(""),
  imageUrl: giftFields.imageUrl.default(""),
  category: giftFields.category.default("main"),
  status: giftFields.status.default("idea"),
  wished: giftFields.wished.default(false),
  priority: giftFields.priority.default(2),
  estPriceCents: giftFields.estPriceCents.default(null),
  actualPriceCents: giftFields.actualPriceCents.default(null),
  store: giftFields.store.default(""),
  orderNumber: giftFields.orderNumber.default(""),
  trackingUrl: giftFields.trackingUrl.default(""),
  returnBy: giftFields.returnBy.default(null),
  watchPrice: giftFields.watchPrice.default(false),
  giverIds: giftFields.giverIds.default([]),
});

export const giftPatch = z.object(giftFields).partial();

const intString = z.string().regex(/^\d+$/).transform(Number);

export const giftQuery = z.object({
  seasonId: z.union([z.literal("none"), intString]).optional(),
  recipientId: intString.optional(),
  status: z
    .string()
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(GIFT_STATUSES)))
    .optional(),
  store: z.string().trim().max(200).optional(),
  category: z.enum(GIFT_CATEGORIES).optional(),
  giverId: intString.optional(),
  wished: z.enum(["0", "1"]).optional(),
  q: z.string().trim().max(200).optional(),
});

export const dashboardQuery = z.object({
  seasonId: intString.optional(),
});

export const activityQuery = z.object({
  limit: intString.pipe(z.number().int().min(1).max(100)).optional(),
  seasonId: intString.optional(),
});

export const linkPreviewBody = z.object({
  url: z.string().trim().min(1).max(2000),
});

export const exportQuery = z.object({
  seasonId: intString.optional(),
});

export const importBody = z.object({
  csv: z.string().max(5_000_000, "CSV is too large"),
  seasonId: id.nullable().default(null),
  dryRun: z.boolean().default(false),
});

// ---------------------------------------------------------------- phase 3

export const historyQuery = z.object({
  personId: intString,
});

export const similarQuery = z.object({
  recipientId: intString,
  title: z.string().max(200),
  excludeId: intString.optional(),
  /** The season being edited (matches in it aren't "given before"); defaults to excludeId's season, else the active one. */
  seasonId: z.union([z.literal("none"), intString]).optional(),
});

export const drawBody = z.object({
  participantIds: z
    .array(id)
    .min(2, "at least 2 participants are needed")
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, { message: "participants must be unique" }),
  avoidPreviousSeason: z.boolean().default(false),
});

/** The browser's credential JSON is checked by @simplewebauthn/server; only the shape is checked here. */
const credentialJson = z
  .object({
    id: z.string().min(1).max(2048),
    rawId: z.string().min(1).max(2048),
    type: z.literal("public-key"),
    response: z.object({ clientDataJSON: z.string().min(1).max(10_000) }).loose(),
  })
  .loose();

export const passkeyRegisterVerifyBody = z.object({
  response: credentialJson,
  name: z.string().trim().max(100).nullish(),
});

export const passkeyLoginVerifyBody = z.object({
  response: credentialJson,
});
