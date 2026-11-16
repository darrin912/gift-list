// Phase 4: My wishlist (docs/API.md). The owner's only way to reach their own wishlist items,
// which every other route keeps hidden from them by the surprise rule.
//
// Privacy: everything here reads and writes the owner's own `wishes` rows. Membership, order and
// every response depend only on those rows (and the season the owner chose), never on the gift the
// spouse plans with: its status, prices, store, givers, recipients, wished flag, season, or whether
// it still exists. Errors depend only on the request body and on whether the wish is the viewer's.
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { giftRecipients, gifts, seasons, wishes } from "../../db/schema";
import { logWishActivity, wishAddedSummary, wishRemovedSummary, wishUpdatedSummary } from "../activity";
import { getOwnWish, loadOwnWishlist } from "../gift-access";
import { fail, idParam, parseJson } from "../http";
import { isSeasonSecret, newWishRow, wishFieldsOf } from "../rules";
import { toWishItem } from "../serialize";
import type { AppEnv, Variables } from "../types";
import { wishCreate, wishPatch } from "../validation";
import { checkRefs } from "./gifts";

type Db = Variables["db"];

export const wishlistRoutes = new Hono<AppEnv>();

/** A wish can go in the ideas inbox (null) or a season that hasn't happened yet and isn't archived. */
async function checkWishSeason(db: Db, seasonId: number | null | undefined, today: string): Promise<void> {
  if (seasonId == null) return;
  const s = await db.select().from(seasons).where(eq(seasons.id, seasonId)).get();
  if (!s || !isSeasonSecret(s, today)) fail(400, "seasonId: choose an upcoming season, or none");
}

function requirePerson(personId: number | null): number {
  if (personId == null) fail(400, "Your account isn't linked to a person, so it can't have a wishlist");
  return personId;
}

wishlistRoutes.get("/", async (c) => {
  const rows = await loadOwnWishlist(c.var.db, c.var.user, c.var.today);
  return c.json(rows.map(toWishItem));
});

wishlistRoutes.post("/", async (c) => {
  const body = await parseJson(c, wishCreate);
  const db = c.var.db;
  const user = c.var.user;
  const personId = requirePerson(user.personId);
  await checkWishSeason(db, body.seasonId, c.var.today);
  await checkRefs(db, { newRecipientIds: [personId] });
  const now = new Date().toISOString();
  const gift = await db
    .insert(gifts)
    .values({ ...body, status: "idea", wished: true, isFamily: false, createdBy: user.id, updatedBy: user.id, createdAt: now, updatedAt: now })
    .returning()
    .get();
  const wish = newWishRow(gift.id, user.id, gift, now);
  await db.batch([
    db.insert(giftRecipients).values({ giftId: gift.id, personId }),
    db.insert(wishes).values(wish),
    logWishActivity(db, { id: user.id, personId }, "create", gift.id, wishAddedSummary(gift.title)),
  ]);
  return c.json(toWishItem(wish), 201);
});

wishlistRoutes.patch("/:id", async (c) => {
  const id = idParam(c);
  const db = c.var.db;
  const user = c.var.user;
  const before = await getOwnWish(db, user, c.var.today, id);
  const body = await parseJson(c, wishPatch);
  await checkWishSeason(db, body.seasonId, c.var.today);

  const changed = (Object.keys(body) as (keyof typeof body)[]).some((k) => body[k] !== before[k]);
  if (!changed) return c.json(toWishItem(before));

  const now = new Date().toISOString();
  const next = { ...before, ...wishFieldsOf({ ...before, ...body }), updatedAt: now };
  await db.update(wishes).set(next).where(eq(wishes.id, id)).run();

  // The live gift (if the spouse hasn't deleted it) takes the owner's edits too, so the spouse
  // sees them. The season only follows while the gift is still where the owner had put it; if the
  // spouse moved it for their planning, only the owner's own choice changes. Either way the
  // response, and everything else the owner can see, is the same.
  if (before.giftId != null) {
    const gift = await db.select({ seasonId: gifts.seasonId, title: gifts.title }).from(gifts).where(eq(gifts.id, before.giftId)).get();
    if (gift) {
      const { seasonId, ...fields } = body;
      const set: Partial<typeof gifts.$inferInsert> = { ...fields, updatedBy: user.id, updatedAt: now };
      if (seasonId !== undefined && gift.seasonId === before.seasonId) set.seasonId = seasonId;
      await db.batch([
        db.update(gifts).set(set).where(eq(gifts.id, before.giftId)),
        logWishActivity(db, { id: user.id, personId: requirePerson(user.personId) }, "update", before.giftId, wishUpdatedSummary(fields.title ?? gift.title)),
      ]);
    }
  }
  return c.json(toWishItem(next));
});

wishlistRoutes.delete("/:id", async (c) => {
  const id = idParam(c);
  const db = c.var.db;
  const user = c.var.user;
  const wish = await getOwnWish(db, user, c.var.today, id);
  // Always a soft withdraw, whatever happened to the gift: the spouse may already have bought it.
  const now = new Date().toISOString();
  await db.update(wishes).set({ withdrawnAt: now }).where(eq(wishes.id, id)).run();
  if (wish.giftId != null) {
    const gift = await db.select({ title: gifts.title }).from(gifts).where(eq(gifts.id, wish.giftId)).get();
    if (gift) {
      await db.batch([
        db.update(gifts).set({ withdrawnAt: now, updatedBy: user.id, updatedAt: now }).where(eq(gifts.id, wish.giftId)),
        logWishActivity(db, { id: user.id, personId: requirePerson(user.personId) }, "update", wish.giftId, wishRemovedSummary(gift.title)),
      ]);
    }
  }
  return c.json({ ok: true });
});
