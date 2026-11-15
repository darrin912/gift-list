// The Money rules and the Surprise rule from docs/API.md, in one place.
// Every route that returns or counts gifts must go through these helpers.
import { GIFT_STATUSES, type GiftStatus } from "../db/schema";

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

/**
 * A gift is hidden from the signed-in user when it's for the user's own person and
 * its season is neither archived nor past (season date < today). Ideas-inbox gifts
 * (no season) are always hidden from their recipient.
 */
export function isGiftHidden(
  gift: { recipientId: number },
  season: SeasonForRule | null,
  viewerPersonId: number | null,
  today: string,
): boolean {
  if (viewerPersonId == null || gift.recipientId !== viewerPersonId) return false;
  if (!season) return true;
  if (season.archived) return false;
  return season.date >= today;
}

/** Whether the season is still "live" for the surprise rule (not archived, not past). */
export function isSeasonSecret(season: SeasonForRule, today: string): boolean {
  return !season.archived && season.date >= today;
}
