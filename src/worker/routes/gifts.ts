import { and, desc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { giftGivers, giftRecipients, gifts, people, seasons } from "../../db/schema";
import { createdSummary, deletedSummary, logGiftActivity, recipientLabel, updatedSummary } from "../activity";
import {
  getVisibleGift,
  hasAnyRecipient,
  hasRecipient,
  loadGiverIds,
  loadVisibleGifts,
  type GiftWithRecipients,
} from "../gift-access";
import { fail, idParam, parseJson, parseQuery } from "../http";
import { checkFetchUrl } from "../link-preview";
import { checkGiftPrice } from "../price-watch";
import { takeRateLimit } from "../rate-limit";
import { titlesSimilar } from "../rules";
import { toGift, toSeason } from "../serialize";
import type { AppEnv, Variables } from "../types";
import { giftCreate, giftPatch, giftQuery, historyQuery, recipientsError, similarQuery } from "../validation";

export const CHECK_PRICE_MAX_PER_MINUTE = 10;
export const SIMILAR_MAX = 5;
const SIMILAR_EXCLUDED_STATUSES = ["returned", "idea"] as const;

type Db = Variables["db"];

export const giftRoutes = new Hono<AppEnv>();

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

giftRoutes.get("/", async (c) => {
  const f = parseQuery(c, giftQuery);
  const conds: SQL[] = [];
  if (f.seasonId === "none") conds.push(isNull(gifts.seasonId));
  else if (f.seasonId !== undefined) conds.push(eq(gifts.seasonId, f.seasonId));
  if (f.recipientId === "family") conds.push(eq(gifts.isFamily, true));
  else if (f.recipientId !== undefined) conds.push(hasRecipient(f.recipientId));
  if (f.status && f.status.length > 0) conds.push(inArray(gifts.status, f.status));
  if (f.store) conds.push(sql`lower(${gifts.store}) = lower(${f.store})`);
  if (f.category) conds.push(eq(gifts.category, f.category));
  if (f.giverId !== undefined) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${giftGivers} WHERE ${giftGivers.giftId} = ${gifts.id} AND ${giftGivers.personId} = ${f.giverId})`,
    );
  }
  if (f.wished !== undefined) conds.push(eq(gifts.wished, f.wished === "1"));
  if (f.q) {
    const pattern = `%${escapeLike(f.q)}%`;
    conds.push(
      or(
        sql`${gifts.title} LIKE ${pattern} ESCAPE '\\'`,
        sql`${gifts.description} LIKE ${pattern} ESCAPE '\\'`,
        sql`${gifts.store} LIKE ${pattern} ESCAPE '\\'`,
      )!,
    );
  }

  const rows = await loadVisibleGifts(c.var.db, c.var.user, c.var.today, conds.length ? and(...conds) : undefined);
  rows.sort((a, b) => (a.gift.createdAt < b.gift.createdAt ? 1 : a.gift.createdAt > b.gift.createdAt ? -1 : b.gift.id - a.gift.id));
  const givers = await loadGiverIds(
    c.var.db,
    rows.map((r) => r.gift.id),
  );
  return c.json(rows.map((r) => toGift(r.gift, givers.get(r.gift.id) ?? [])));
});

/**
 * 400s if any referenced season or person doesn't exist, or a recipient is giver-only or archived.
 * `newRecipientIds` are the recipients being added (people already on the gift aren't re-checked
 * for being archived since).
 */
export async function checkRefs(
  db: Db,
  refs: { seasonId?: number | null; newRecipientIds?: number[]; giverIds?: number[] },
): Promise<void> {
  if (refs.seasonId != null) {
    const s = await db.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, refs.seasonId)).get();
    if (!s) fail(400, "seasonId: season not found");
  }
  if (refs.newRecipientIds && refs.newRecipientIds.length > 0) {
    const found = await db
      .select({ id: people.id, giverOnly: people.giverOnly, archived: people.archived })
      .from(people)
      .where(inArray(people.id, refs.newRecipientIds))
      .all();
    if (found.length !== refs.newRecipientIds.length) fail(400, "recipientIds: person not found");
    if (found.some((p) => p.giverOnly)) fail(400, "recipientIds: giver-only people can't receive gifts");
    if (found.some((p) => p.archived)) fail(400, "recipientIds: archived people can't receive gifts");
  }
  if (refs.giverIds && refs.giverIds.length > 0) {
    const found = await db.select({ id: people.id }).from(people).where(inArray(people.id, refs.giverIds)).all();
    if (found.length !== refs.giverIds.length) fail(400, "giverIds: person not found");
  }
}

/** "Ava", "Ava & Ben" (by ascending person id), or "the family". */
async function giftRecipientLabel(db: Db, gift: Pick<GiftWithRecipients, "recipientIds" | "isFamily">): Promise<string> {
  if (gift.isFamily || gift.recipientIds.length === 0) return recipientLabel([], gift.isFamily);
  const rows = await db.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, gift.recipientIds)).all();
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return recipientLabel(
    [...gift.recipientIds].sort((a, b) => a - b).map((id) => byId.get(id) ?? "someone"),
    false,
  );
}

function recipientRows(giftId: number, personIds: number[]) {
  return personIds.map((personId) => ({ giftId, personId }));
}

giftRoutes.post("/", async (c) => {
  const { giverIds, recipientIds, ...body } = await parseJson(c, giftCreate);
  const db = c.var.db;
  const user = c.var.user;
  await checkRefs(db, { seasonId: body.seasonId, newRecipientIds: recipientIds, giverIds });
  const now = new Date().toISOString();
  const row = await db
    .insert(gifts)
    .values({ ...body, createdBy: user.id, updatedBy: user.id, createdAt: now, updatedAt: now })
    .returning()
    .get();
  const gift: GiftWithRecipients = { ...row, recipientIds: [...recipientIds].sort((a, b) => a - b) };
  const label = await giftRecipientLabel(db, gift);
  await db.batch([
    logGiftActivity(db, user.id, "create", gift, createdSummary(gift.title, label)),
    ...(recipientIds.length ? [db.insert(giftRecipients).values(recipientRows(gift.id, recipientIds))] : []),
    ...(giverIds.length ? [db.insert(giftGivers).values(giverIds.map((personId) => ({ giftId: gift.id, personId })))] : []),
  ]);
  // Note: a gift created for yourself is returned this once (you just typed it) but is
  // hidden from every later read by the surprise rule.
  return c.json(toGift(gift, giverIds), 201);
});

/**
 * GET /gifts/similar: the "given before" warning. Same recipient, other seasons (not the season
 * being edited), similar normalized title, not returned/idea, surprise rule applied.
 */
giftRoutes.get("/similar", async (c) => {
  const f = parseQuery(c, similarQuery);
  const db = c.var.db;
  const user = c.var.user;
  const today = c.var.today;

  let currentSeasonId: number | null | undefined;
  if (f.seasonId !== undefined) currentSeasonId = f.seasonId === "none" ? null : f.seasonId;
  if (currentSeasonId === undefined && f.excludeId !== undefined) {
    const self = (await loadVisibleGifts(db, user, today, eq(gifts.id, f.excludeId)))[0];
    if (self) currentSeasonId = self.gift.seasonId;
  }
  if (currentSeasonId === undefined) {
    const active = await db.select({ id: seasons.id }).from(seasons).where(eq(seasons.isActive, true)).get();
    currentSeasonId = active?.id ?? null;
  }

  let who: SQL;
  if (f.recipientIds === "family") who = eq(gifts.isFamily, true);
  else if (f.recipientIds !== undefined) who = hasAnyRecipient(f.recipientIds);
  else if (f.recipientId !== undefined) who = hasRecipient(f.recipientId);
  else fail(400, "recipientIds: required");

  const conds: SQL[] = [
    who,
    isNotNull(gifts.seasonId),
    notInArray(gifts.status, [...SIMILAR_EXCLUDED_STATUSES]),
  ];
  if (currentSeasonId != null) conds.push(ne(gifts.seasonId, currentSeasonId));
  if (f.excludeId !== undefined) conds.push(ne(gifts.id, f.excludeId));
  const rows = await loadVisibleGifts(db, user, today, and(...conds));
  const matches = rows
    .filter((r) => r.season && titlesSimilar(f.title, r.gift.title))
    .sort((a, b) => (a.season!.date < b.season!.date ? 1 : a.season!.date > b.season!.date ? -1 : b.gift.id - a.gift.id))
    .slice(0, SIMILAR_MAX);
  return c.json(
    matches.map((r) => ({
      giftId: r.gift.id,
      title: r.gift.title,
      seasonName: r.season!.name,
      seasonDate: r.season!.date,
      status: r.gift.status,
    })),
  );
});

giftRoutes.post("/:id/check-price", async (c) => {
  const id = idParam(c);
  const db = c.var.db;
  const { gift } = await getVisibleGift(db, c.var.user, c.var.today, id);
  if (!gift.url) fail(400, "This gift has no link to check");
  const check = checkFetchUrl(gift.url);
  if (!check.ok) fail(400, check.reason);
  const allowed = await takeRateLimit(db, `check-price:${c.var.user.id}`, CHECK_PRICE_MAX_PER_MINUTE, 60_000);
  if (!allowed) {
    c.header("Retry-After", "60");
    fail(429, "Too many price checks. Try again in a minute.");
  }
  const result = await checkGiftPrice(db, gift);
  const givers = await loadGiverIds(db, [id]);
  return c.json(toGift({ ...result.gift, recipientIds: gift.recipientIds }, givers.get(id) ?? []));
});

giftRoutes.get("/:id", async (c) => {
  const id = idParam(c);
  const { gift } = await getVisibleGift(c.var.db, c.var.user, c.var.today, id);
  const givers = await loadGiverIds(c.var.db, [gift.id]);
  return c.json(toGift(gift, givers.get(gift.id) ?? []));
});

giftRoutes.patch("/:id", async (c) => {
  const id = idParam(c);
  const db = c.var.db;
  const user = c.var.user;
  const before = (await getVisibleGift(db, user, c.var.today, id)).gift;
  const { giverIds, recipientIds: recipientIdsIn, ...body } = await parseJson(c, giftPatch);

  // Recipients: setting isFamily: true alone clears the people; sending people alone makes it a
  // non-family gift. The resulting combination must be valid either way.
  let recipientIds = recipientIdsIn;
  if (body.isFamily === undefined && recipientIds !== undefined && recipientIds.length > 0) body.isFamily = false;
  if (body.isFamily === true && recipientIds === undefined) recipientIds = [];
  const isFamily = body.isFamily ?? before.isFamily;
  const nextRecipients = [...(recipientIds ?? before.recipientIds)].sort((a, b) => a - b);
  const error = recipientsError(isFamily, nextRecipients);
  if (error) fail(400, error);
  const added = recipientIds ? recipientIds.filter((p) => !before.recipientIds.includes(p)) : [];
  await checkRefs(db, { seasonId: body.seasonId, newRecipientIds: added, giverIds });

  const row = await db
    .update(gifts)
    .set({ ...body, updatedBy: user.id, updatedAt: new Date().toISOString() })
    .where(eq(gifts.id, id))
    .returning()
    .get();
  if (!row) fail(404, "Gift not found");
  const gift: GiftWithRecipients = { ...row, recipientIds: nextRecipients };

  const label = await giftRecipientLabel(db, gift);
  const giversBefore = giverIds ? ((await loadGiverIds(db, [id])).get(id) ?? []) : [];
  const summary = updatedSummary(before, gift, { recipient: label }, giverIds ? { before: giversBefore, after: giverIds } : undefined);
  const stmts = [
    ...(summary ? [logGiftActivity(db, user.id, "update", gift, summary)] : []),
    ...(recipientIds
      ? [
          db.delete(giftRecipients).where(eq(giftRecipients.giftId, id)),
          ...(nextRecipients.length ? [db.insert(giftRecipients).values(recipientRows(id, nextRecipients))] : []),
        ]
      : []),
    ...(giverIds
      ? [
          db.delete(giftGivers).where(eq(giftGivers.giftId, id)),
          ...(giverIds.length ? [db.insert(giftGivers).values(giverIds.map((personId) => ({ giftId: id, personId })))] : []),
        ]
      : []),
  ];
  // Nothing changed -> no activity row and nothing to write.
  if (stmts.length) await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  const givers = giverIds ?? (await loadGiverIds(db, [id])).get(id) ?? [];
  return c.json(toGift(gift, givers));
});

giftRoutes.delete("/:id", async (c) => {
  const id = idParam(c);
  const db = c.var.db;
  const user = c.var.user;
  const { gift } = await getVisibleGift(db, user, c.var.today, id);
  const label = await giftRecipientLabel(db, gift);
  await db.batch([
    db.delete(gifts).where(eq(gifts.id, id)),
    logGiftActivity(db, user.id, "delete", gift, deletedSummary(gift.title, label)),
  ]);
  return c.json({ ok: true });
});

/** GET /stores: distinct store names, most used first. Unaffected by the surprise rule. */
export async function listStores(db: Db): Promise<string[]> {
  const rows = await db
    .select({ store: gifts.store, n: sql<number>`count(*)` })
    .from(gifts)
    .where(sql`${gifts.store} <> ''`)
    .groupBy(gifts.store)
    .orderBy(desc(sql`count(*)`), gifts.store)
    .all();
  return rows.map((r) => r.store);
}

/**
 * GET /history?personId=: the person's gifts grouped by season, newest season first. Leaves out
 * the active season, the ideas inbox, and (surprise rule) anything hidden from the viewer.
 */
export async function loadHistory(c: import("hono").Context<AppEnv>) {
  const { personId } = parseQuery(c, historyQuery);
  const db = c.var.db;
  const rows = await loadVisibleGifts(
    db,
    c.var.user,
    c.var.today,
    and(hasRecipient(personId), isNotNull(gifts.seasonId), eq(seasons.isActive, false)),
  );
  const bySeason = new Map<number, { season: NonNullable<(typeof rows)[number]["season"]>; gifts: typeof rows }>();
  for (const r of rows) {
    if (!r.season) continue;
    const entry = bySeason.get(r.season.id) ?? { season: r.season, gifts: [] };
    entry.gifts.push(r);
    bySeason.set(r.season.id, entry);
  }
  const groups = [...bySeason.values()].sort((a, b) =>
    a.season.date < b.season.date ? 1 : a.season.date > b.season.date ? -1 : b.season.id - a.season.id,
  );
  const givers = await loadGiverIds(
    db,
    rows.map((r) => r.gift.id),
  );
  return groups.map((g) => ({
    season: toSeason(g.season),
    gifts: g.gifts
      .sort((a, b) => (a.gift.createdAt < b.gift.createdAt ? -1 : a.gift.createdAt > b.gift.createdAt ? 1 : a.gift.id - b.gift.id))
      .map((r) => toGift(r.gift, givers.get(r.gift.id) ?? [])),
  }));
}
