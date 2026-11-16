// Phase 4: My wishlist (docs/API.md). The owner's only way to reach their own wishlist items,
// which every other route keeps hidden from them by the surprise rule.
//
// Privacy: every response here is built from the owner's own snapshot (toWishItem) and membership
// comes from loadOwnWishlist, which never looks at status, prices, store, givers or any other
// planning field. Errors depend only on the request body and on whether the item is the viewer's
// own, live (inbox or a season that isn't past/archived) and not withdrawn.
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { giftRecipients, gifts, seasons, type WishSnapshot } from "../../db/schema";
import { logGiftActivity, wishAddedSummary, wishRemovedSummary, wishUpdatedSummary } from "../activity";
import { getOwnWish, loadOwnWishlist, type GiftWithRecipients } from "../gift-access";
import { fail, idParam, parseJson } from "../http";
import { isSeasonSecret, wishSnapshotOf } from "../rules";
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

wishlistRoutes.get("/", async (c) => {
  const rows = await loadOwnWishlist(c.var.db, c.var.user, c.var.today);
  return c.json(rows.map((r) => toWishItem(r.gift)));
});

wishlistRoutes.post("/", async (c) => {
  const body = await parseJson(c, wishCreate);
  const db = c.var.db;
  const user = c.var.user;
  if (user.personId == null) fail(400, "Your account isn't linked to a person, so it can't have a wishlist");
  await checkWishSeason(db, body.seasonId, c.var.today);
  await checkRefs(db, { newRecipientIds: [user.personId] });
  const now = new Date().toISOString();
  const row = await db
    .insert(gifts)
    .values({
      ...body,
      status: "idea",
      wished: true,
      isFamily: false,
      wishSnapshot: wishSnapshotOf(body, now),
      createdBy: user.id,
      updatedBy: user.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  const gift: GiftWithRecipients = { ...row, recipientIds: [user.personId], creatorPersonId: user.personId };
  await db.batch([
    db.insert(giftRecipients).values({ giftId: gift.id, personId: user.personId }),
    logGiftActivity(db, user.id, "create", gift, wishAddedSummary(gift.title)),
  ]);
  return c.json(toWishItem(gift), 201);
});

wishlistRoutes.patch("/:id", async (c) => {
  const id = idParam(c);
  const db = c.var.db;
  const user = c.var.user;
  const { gift: before } = await getOwnWish(db, user, c.var.today, id);
  const body = await parseJson(c, wishPatch);
  await checkWishSeason(db, body.seasonId, c.var.today);

  const old: WishSnapshot = toWishItem(before);
  const changed = (Object.keys(body) as (keyof typeof body)[]).some((k) => body[k] !== old[k]);
  if (!changed) return c.json(toWishItem(before));

  const now = new Date().toISOString();
  const snapshot: WishSnapshot = { ...wishSnapshotOf({ ...old, ...body }, now) };
  // The live gift takes the owner's edits too, so the spouse sees them. The season only follows
  // while the gift is still where the owner put it: if the spouse has moved it for their planning,
  // the owner's choice is kept in the snapshot only (and the response is the same either way).
  const { seasonId, ...fields } = body;
  const set: Partial<typeof gifts.$inferInsert> = { ...fields, wishSnapshot: snapshot, updatedBy: user.id, updatedAt: now };
  if (seasonId !== undefined && before.seasonId === old.seasonId) set.seasonId = seasonId;
  const row = await db.update(gifts).set(set).where(eq(gifts.id, id)).returning().get();
  if (!row) fail(404, "Wish not found");
  const gift: GiftWithRecipients = { ...row, recipientIds: before.recipientIds, creatorPersonId: before.creatorPersonId };
  await logGiftActivity(db, user.id, "update", gift, wishUpdatedSummary(gift.title)).run();
  return c.json(toWishItem(gift));
});

wishlistRoutes.delete("/:id", async (c) => {
  const id = idParam(c);
  const db = c.var.db;
  const user = c.var.user;
  const { gift } = await getOwnWish(db, user, c.var.today, id);
  // Always a soft withdraw, whatever the gift's status: the spouse may already have bought it.
  const now = new Date().toISOString();
  await db.batch([
    db.update(gifts).set({ withdrawnAt: now, updatedBy: user.id, updatedAt: now }).where(eq(gifts.id, id)),
    logGiftActivity(db, user.id, "update", gift, wishRemovedSummary(gift.title)),
  ]);
  return c.json({ ok: true });
});
