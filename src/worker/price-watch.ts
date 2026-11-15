// Price-drop watch: re-reads a watched gift's product page with the link-preview fetcher
// (same SSRF guards) and records the price. Used by the daily Cron Trigger and by
// POST /gifts/:id/check-price.
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { activityLog, gifts, type GiftRow, type GiftStatus } from "../db/schema";
import { loadRecipientIds } from "./gift-access";
import { checkFetchUrl, fetchLinkPreview } from "./link-preview";
import { formatCents } from "./price";
import { isPriceDrop } from "./rules";
import type { Variables } from "./types";

type Db = Variables["db"];
type Fetcher = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;

export const PRICE_WATCH_STATUSES: readonly GiftStatus[] = ["idea", "planned"];
export const PRICE_WATCH_BATCH = 25;
export const PRICE_WATCH_ACTOR = "price-watch";
export const PRICE_WATCH_USER_NAME = "Price watch";

export function priceDropSummary(title: string, fromCents: number, toCents: number): string {
  return `Price dropped on "${title}": $${formatCents(fromCents)} → $${formatCents(toCents)}`;
}

export interface PriceCheckOutcome {
  gift: GiftRow;
  priceCents: number | null;
  dropped: boolean;
}

/**
 * Checks one gift's price and saves the result. Never throws for remote failures: a bad
 * URL or a page without a price only updates last_checked_at.
 */
export async function checkGiftPrice(
  db: Db,
  gift: GiftRow,
  opts: { fetcher?: Fetcher; now?: Date } = {},
): Promise<PriceCheckOutcome> {
  const nowIso = (opts.now ?? new Date()).toISOString();
  let priceCents: number | null = null;
  const target = gift.url ? checkFetchUrl(gift.url) : null;
  if (target?.ok) {
    try {
      const preview = await fetchLinkPreview(target.url, opts.fetcher ? { fetcher: opts.fetcher } : {});
      priceCents = preview.priceCents;
    } catch {
      priceCents = null;
    }
  }

  if (priceCents == null) {
    const updated = await db.update(gifts).set({ lastCheckedAt: nowIso }).where(eq(gifts.id, gift.id)).returning().get();
    return { gift: updated ?? { ...gift, lastCheckedAt: nowIso }, priceCents: null, dropped: false };
  }

  const reference = gift.lastSeenPriceCents ?? gift.estPriceCents;
  const dropped = isPriceDrop(reference, priceCents);
  const set: Partial<GiftRow> = {
    lastCheckedAt: nowIso,
    lastSeenPriceCents: priceCents,
    lowestSeenPriceCents: Math.min(gift.lowestSeenPriceCents ?? priceCents, priceCents),
  };
  if (dropped) set.priceDroppedAt = nowIso;
  const update = db.update(gifts).set(set).where(eq(gifts.id, gift.id)).returning();
  if (!dropped) {
    const updated = await update.get();
    return { gift: updated ?? { ...gift, ...set }, priceCents, dropped };
  }
  // System-attributed activity row; recipients/season are kept so the feed applies the surprise rule.
  const recipientIds = gift.isFamily ? [] : await loadRecipientIds(db, gift.id);
  const [rows] = await db.batch([
    update,
    db.insert(activityLog).values({
      userId: null,
      systemActor: PRICE_WATCH_ACTOR,
      giftId: gift.id,
      recipientId: recipientIds[0] ?? null,
      recipientIds,
      seasonId: gift.seasonId,
      action: "update",
      summary: priceDropSummary(gift.title, reference!, priceCents),
      at: nowIso,
    }),
  ]);
  return { gift: rows[0] ?? { ...gift, ...set }, priceCents, dropped };
}

/** Up to `limit` watched gifts with a URL and status idea/planned, never-checked first, then oldest checked. */
export async function pickWatchedGifts(db: Db, limit = PRICE_WATCH_BATCH): Promise<GiftRow[]> {
  return db
    .select()
    .from(gifts)
    .where(and(eq(gifts.watchPrice, true), ne(gifts.url, ""), inArray(gifts.status, [...PRICE_WATCH_STATUSES])))
    .orderBy(sql`${gifts.lastCheckedAt} IS NOT NULL`, asc(gifts.lastCheckedAt), asc(gifts.id))
    .limit(limit)
    .all();
}

/** The daily Cron Trigger: checks a batch of watched gifts, one at a time. */
export async function runPriceWatch(
  db: Db,
  opts: { fetcher?: Fetcher; now?: Date; limit?: number } = {},
): Promise<{ checked: number; dropped: number }> {
  const batch = await pickWatchedGifts(db, opts.limit ?? PRICE_WATCH_BATCH);
  let dropped = 0;
  for (const gift of batch) {
    try {
      const r = await checkGiftPrice(db, gift, opts);
      if (r.dropped) dropped++;
    } catch (err) {
      // A DB hiccup on one gift shouldn't stop the rest.
      console.error("price watch failed for gift", gift.id, err);
    }
  }
  return { checked: batch.length, dropped };
}
