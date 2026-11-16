// The Money rules and the Surprise rule from docs/API.md, in one place.
// Every route that returns or counts gifts must go through these helpers.
import { GIFT_STATUSES, type GiftRow, type GiftStatus, type WishSnapshot } from "../db/schema";

// ---------------------------------------------------------------- dates

/**
 * Today's date as YYYY-MM-DD.
 * SIMPLIFICATION: uses the UTC date, not the family's local time zone, so "today"
 * flips over at UTC midnight (evening of the previous day in the US).
 */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Adds whole days to a YYYY-MM-DD date (UTC arithmetic). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- money rules

export const SPENT_STATUSES: readonly GiftStatus[] = ["ordered", "received", "wrapped", "given"];
export const COMMITTED_STATUSES: readonly GiftStatus[] = ["planned"];
export const RETURN_WATCH_STATUSES: readonly GiftStatus[] = ["ordered", "received", "wrapped"];

export interface PricedGift {
  status: GiftStatus;
  estPriceCents: number | null;
  actualPriceCents: number | null;
}

/** Effective price = actualPriceCents ?? estPriceCents ?? 0 */
export function effectivePriceCents(g: Pick<PricedGift, "estPriceCents" | "actualPriceCents">): number {
  return g.actualPriceCents ?? g.estPriceCents ?? 0;
}

export function isSpent(status: GiftStatus): boolean {
  return SPENT_STATUSES.includes(status);
}

export function isCommitted(status: GiftStatus): boolean {
  return COMMITTED_STATUSES.includes(status);
}

/**
 * Whether a gift "counts" toward giftCount / stockingCount: the same gifts that
 * count toward money (spent or committed). `idea` and `returned` gifts don't.
 */
export function isCounted(status: GiftStatus): boolean {
  return isSpent(status) || isCommitted(status);
}

export interface MoneyTotals {
  spentCents: number;
  committedCents: number;
  giftCount: number;
}

export function sumMoney(gifts: readonly PricedGift[]): MoneyTotals {
  let spentCents = 0;
  let committedCents = 0;
  let giftCount = 0;
  for (const g of gifts) {
    const price = effectivePriceCents(g);
    if (isSpent(g.status)) spentCents += price;
    else if (isCommitted(g.status)) committedCents += price;
    if (isCounted(g.status)) giftCount++;
  }
  return { spentCents, committedCents, giftCount };
}

/** Remaining = budget − spent − committed (can go negative when over budget). */
export function remainingCents(budgetCents: number, t: Pick<MoneyTotals, "spentCents" | "committedCents">): number {
  return budgetCents - t.spentCents - t.committedCents;
}

/**
 * Splits `priceCents` evenly between `personIds`: each gets floor(price / n), and the remainder
 * cents go one each to the people in ascending id order, so the shares always add up to the price.
 * 1000 between [3, 1, 2] -> {1: 334, 2: 333, 3: 333}.
 */
export function splitCents(priceCents: number, personIds: readonly number[]): Map<number, number> {
  const ids = [...new Set(personIds)].sort((a, b) => a - b);
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const base = Math.floor(priceCents / ids.length);
  const remainder = priceCents - base * ids.length;
  ids.forEach((id, i) => out.set(id, base + (i < remainder ? 1 : 0)));
  return out;
}

/** One person's share of the money rules: their split of each gift they receive, each gift counted once. */
export function sumMoneyFor(
  gifts: readonly (PricedGift & Pick<GiftRecipients, "recipientIds">)[],
  personId: number,
): MoneyTotals {
  let spentCents = 0;
  let committedCents = 0;
  let giftCount = 0;
  for (const g of gifts) {
    if (!g.recipientIds.includes(personId)) continue;
    const share = splitCents(effectivePriceCents(g), g.recipientIds).get(personId) ?? 0;
    if (isSpent(g.status)) spentCents += share;
    else if (isCommitted(g.status)) committedCents += share;
    if (isCounted(g.status)) giftCount++;
  }
  return { spentCents, committedCents, giftCount };
}

export function emptyStatusCounts(): Record<GiftStatus, number> {
  return Object.fromEntries(GIFT_STATUSES.map((s) => [s, 0])) as Record<GiftStatus, number>;
}

/**
 * Return-by warning for gifts that are ordered/received/wrapped and have a returnBy date:
 * "red" if returnBy is before today, "amber" if it's today or within the next 7 days.
 */
export function returnByLevel(
  g: { status: GiftStatus; returnBy: string | null },
  today: string,
): "amber" | "red" | null {
  if (!g.returnBy || !RETURN_WATCH_STATUSES.includes(g.status)) return null;
  if (g.returnBy < today) return "red";
  if (g.returnBy <= addDays(today, 7)) return "amber";
  return null;
}

// ---------------------------------------------------------------- surprise rule

export interface SeasonForRule {
  date: string;
  archived: boolean;
}

/** Who a gift is for, as the surprise rule and the money rules see it. */
export interface GiftRecipients {
  /** Distinct person ids; empty for family gifts. */
  recipientIds: readonly number[];
  isFamily: boolean;
}

/**
 * A non-family gift is hidden from the signed-in user when the user's own person is among its
 * recipients and its season is neither archived nor past (season date < today). Ideas-inbox gifts
 * (no season) count as never past, so they're always hidden from their recipients.
 * Family gifts are never hidden.
 */
export function isGiftHidden(
  gift: GiftRecipients,
  season: SeasonForRule | null,
  viewerPersonId: number | null,
  today: string,
): boolean {
  if (gift.isFamily) return false;
  if (viewerPersonId == null || !gift.recipientIds.includes(viewerPersonId)) return false;
  if (!season) return true;
  if (season.archived) return false;
  return season.date >= today;
}

/** Whether the season is still "live" for the surprise rule (not archived, not past). */
export function isSeasonSecret(season: SeasonForRule, today: string): boolean {
  return !season.archived && season.date >= today;
}

// ---------------------------------------------------------------- wishlist (phase 4)

/** What decides whether a gift is someone's wishlist item. */
export interface WishlistFacts extends GiftRecipients {
  wished: boolean;
  /** The person linked to the user who created the gift (null: no creator, or creator has no person). */
  creatorPersonId: number | null;
}

/**
 * A wishlist item: created by a user for exactly themselves (one recipient, not a family gift) and
 * marked wished. True from every viewer's perspective. Gifts someone else created for you, even
 * when wished, are not wishlist items and stay fully hidden by the surprise rule.
 */
export function isWishlistItem(g: WishlistFacts): boolean {
  return (
    g.wished &&
    !g.isFamily &&
    g.recipientIds.length === 1 &&
    g.creatorPersonId != null &&
    g.recipientIds[0] === g.creatorPersonId
  );
}

/**
 * Whether the owner (the viewer) can reach this gift through /wishlist: their own wishlist item,
 * not withdrawn, and still hidden from them by the surprise rule (ideas inbox, or a season that
 * isn't past or archived). Once the season is past the item is an ordinary visible gift instead.
 * Deliberately ignores status, prices, store, givers and everything else the spouse plans with.
 */
export function isOnOwnWishlist(
  g: WishlistFacts & { createdBy: number | null; withdrawnAt: string | null },
  season: SeasonForRule | null,
  viewer: { id: number; personId: number | null },
  today: string,
): boolean {
  return (
    g.createdBy === viewer.id &&
    g.withdrawnAt == null &&
    isWishlistItem(g) &&
    isGiftHidden(g, season, viewer.personId, today)
  );
}

/** The owner's snapshot of a wishlist item, from the fields they just set. */
export function wishSnapshotOf(
  g: Pick<GiftRow, "title" | "description" | "url" | "imageUrl" | "category" | "priority" | "estPriceCents" | "seasonId">,
  updatedAt: string,
): WishSnapshot {
  return {
    title: g.title,
    description: g.description,
    url: g.url,
    imageUrl: g.imageUrl,
    category: g.category,
    priority: g.priority,
    estPriceCents: g.estPriceCents,
    seasonId: g.seasonId,
    updatedAt,
  };
}

// ---------------------------------------------------------------- "given before" (similar titles)

/** Minimum normalized length for a title to take part in similar-title matching. */
export const SIMILAR_MIN_LENGTH = 4;

/** Lowercase, punctuation stripped, whitespace collapsed: "LEGO® Set!" -> "lego set". */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // accents
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Equal or one contains the other, after normalizing; both must be at least 4 characters. */
export function titlesSimilar(a: string, b: string): boolean {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (x.length < SIMILAR_MIN_LENGTH || y.length < SIMILAR_MIN_LENGTH) return false;
  return x === y || x.includes(y) || y.includes(x);
}

// ---------------------------------------------------------------- price watch

/** A price drop counts when it's at least $1 or at least 5% of the reference price. */
export const PRICE_DROP_MIN_CENTS = 100;
export const PRICE_DROP_MIN_FRACTION = 0.05;

/**
 * Whether `found` is a drop worth reporting against `reference` (the last seen price, or the
 * estimate on the first check). No reference -> never a drop.
 */
export function isPriceDrop(reference: number | null, found: number): boolean {
  if (reference == null || found >= reference) return false;
  const diff = reference - found;
  return diff >= PRICE_DROP_MIN_CENTS || diff >= reference * PRICE_DROP_MIN_FRACTION;
}
