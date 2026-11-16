import type { GiftCategory, PersonRow, SeasonRow } from "../db/schema";
import type { GiftWithRecipients } from "./gift-access";
import { isWishlistItem, wishSnapshotOf } from "./rules";

export type ApiPerson = PersonRow;
export type ApiSeason = SeasonRow;
export type ApiGift = Omit<GiftWithRecipients, "wishSnapshot" | "creatorPersonId"> & {
  giverIds: number[];
  isWishlistItem: boolean;
};

/** What the owner sees of their own wishlist item. Only these fields, ever (docs/API.md Phase 4). */
export interface WishItem {
  id: number;
  title: string;
  description: string;
  url: string;
  imageUrl: string;
  category: GiftCategory;
  priority: number;
  estPriceCents: number | null;
  seasonId: number | null;
  createdAt: string;
  updatedAt: string;
}

// Drizzle already maps columns to the API's camelCase names; these are explicit so
// the wire shape is obvious and doesn't silently change with the schema.

export function toPerson(p: PersonRow): ApiPerson {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    color: p.color,
    emoji: p.emoji,
    birthday: p.birthday,
    sizes: p.sizes ?? {},
    likes: p.likes,
    dislikes: p.dislikes,
    notes: p.notes,
    sortOrder: p.sortOrder,
    archived: p.archived,
    giverOnly: p.giverOnly,
  };
}

export function toSeason(s: SeasonRow): ApiSeason {
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    date: s.date,
    overallBudgetCents: s.overallBudgetCents,
    isActive: s.isActive,
    archived: s.archived,
    honoreeId: s.honoreeId ?? null,
    familyBudgetCents: s.familyBudgetCents ?? 0,
  };
}

export function toGift(g: GiftWithRecipients, giverIds: number[]): ApiGift {
  return {
    id: g.id,
    seasonId: g.seasonId,
    recipientIds: g.isFamily ? [] : [...g.recipientIds].sort((a, b) => a - b),
    isFamily: g.isFamily,
    title: g.title,
    description: g.description,
    url: g.url,
    imageUrl: g.imageUrl,
    category: g.category,
    status: g.status,
    wished: g.wished,
    priority: g.priority,
    estPriceCents: g.estPriceCents,
    actualPriceCents: g.actualPriceCents,
    store: g.store,
    orderNumber: g.orderNumber,
    trackingUrl: g.trackingUrl,
    returnBy: g.returnBy,
    watchPrice: g.watchPrice,
    lastSeenPriceCents: g.lastSeenPriceCents,
    lowestSeenPriceCents: g.lowestSeenPriceCents,
    lastCheckedAt: g.lastCheckedAt,
    priceDroppedAt: g.priceDroppedAt,
    isWishlistItem: isWishlistItem(g),
    withdrawnAt: g.withdrawnAt ?? null,
    giverIds: [...giverIds].sort((a, b) => a - b),
    createdBy: g.createdBy,
    updatedBy: g.updatedBy,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}

/**
 * The owner's view of their wishlist item, built only from the owner's own snapshot (never from the
 * live gift, which the spouse may have planned, bought, re-priced or moved). Gifts that predate the
 * snapshot fall back to the fields as created, and to createdAt for updatedAt.
 */
export function toWishItem(g: Pick<GiftWithRecipients, "id" | "createdAt" | "wishSnapshot"> & Parameters<typeof wishSnapshotOf>[0]): WishItem {
  const s = g.wishSnapshot ?? wishSnapshotOf(g, g.createdAt);
  return {
    id: g.id,
    title: s.title,
    description: s.description,
    url: s.url,
    imageUrl: s.imageUrl,
    category: s.category,
    priority: s.priority,
    estPriceCents: s.estPriceCents,
    seasonId: s.seasonId,
    createdAt: g.createdAt,
    updatedAt: s.updatedAt,
  };
}
