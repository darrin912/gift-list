import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { giftGivers, gifts, people, seasons } from "../../db/schema";
import { createdSummary, deletedSummary, logGiftActivity, updatedSummary } from "../activity";
import { getVisibleGift, loadGiverIds, loadVisibleGifts } from "../gift-access";
import { fail, idParam, parseJson, parseQuery } from "../http";
import { toGift } from "../serialize";
import type { AppEnv, Variables } from "../types";
import { giftCreate, giftPatch, giftQuery } from "../validation";

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
  if (f.recipientId !== undefined) conds.push(eq(gifts.recipientId, f.recipientId));
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

/** 400s if any referenced season or person doesn't exist, or the recipient is giver-only. */
export async function checkRefs(
  db: Db,
  refs: { seasonId?: number | null; recipientId?: number; giverIds?: number[] },
): Promise<void> {
  if (refs.seasonId != null) {
    const s = await db.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, refs.seasonId)).get();
    if (!s) fail(400, "seasonId: season not found");
  }
  if (refs.recipientId !== undefined) {
    const p = await db
      .select({ id: people.id, giverOnly: people.giverOnly })
      .from(people)
      .where(eq(people.id, refs.recipientId))
      .get();
    if (!p) fail(400, "recipientId: person not found");
    if (p.giverOnly) fail(400, "recipientId: this person only gives gifts");
  }
  if (refs.giverIds && refs.giverIds.length > 0) {
    const found = await db.select({ id: people.id }).from(people).where(inArray(people.id, refs.giverIds)).all();
    if (found.length !== refs.giverIds.length) fail(400, "giverIds: person not found");
  }
}

async function personName(db: Db, id: number): Promise<string> {
  const p = await db.select({ name: people.name }).from(people).where(eq(people.id, id)).get();
  return p?.name ?? "someone";
}

giftRoutes.post("/", async (c) => {
  const { giverIds, ...body } = await parseJson(c, giftCreate);
  const db = c.var.db;
  const user = c.var.user;
  await checkRefs(db, { seasonId: body.seasonId, recipientId: body.recipientId, giverIds });
  const now = new Date().toISOString();
  const gift = await db
    .insert(gifts)
    .values({ ...body, createdBy: user.id, updatedBy: user.id, createdAt: now, updatedAt: now })
    .returning()
    .get();
  const name = await personName(db, gift.recipientId);
  await db.batch([
    logGiftActivity(db, user.id, "create", gift, createdSummary(gift.title, name)),
    ...(giverIds.length ? [db.insert(giftGivers).values(giverIds.map((personId) => ({ giftId: gift.id, personId })))] : []),
  ]);
  // Note: a gift created for yourself is returned this once (you just typed it) but is
  // hidden from every later read by the surprise rule.
  return c.json(toGift(gift, giverIds), 201);
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
  const { giverIds, ...body } = await parseJson(c, giftPatch);
  await checkRefs(db, { seasonId: body.seasonId, recipientId: body.recipientId, giverIds });

  const gift = await db
    .update(gifts)
    .set({ ...body, updatedBy: user.id, updatedAt: new Date().toISOString() })
    .where(eq(gifts.id, id))
    .returning()
    .get();
  if (!gift) fail(404, "Gift not found");

  const name = await personName(db, gift.recipientId);
  const giversBefore = giverIds ? ((await loadGiverIds(db, [id])).get(id) ?? []) : [];
  const summary = updatedSummary(before, gift, { recipient: name }, giverIds ? { before: giversBefore, after: giverIds } : undefined);
  const stmts = [
    ...(summary ? [logGiftActivity(db, user.id, "update", gift, summary)] : []),
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
  const name = await personName(db, gift.recipientId);
  await db.batch([
    db.delete(gifts).where(eq(gifts.id, id)),
    logGiftActivity(db, user.id, "delete", gift, deletedSummary(gift.title, name)),
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
