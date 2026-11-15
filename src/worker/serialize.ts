import type { GiftRow, PersonRow, SeasonRow } from "../db/schema";

export type ApiPerson = PersonRow;
export type ApiSeason = SeasonRow;
export type ApiGift = GiftRow & { giverIds: number[] };

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
  };
}

export function toGift(g: GiftRow, giverIds: number[]): ApiGift {
  return {
    id: g.id,
    seasonId: g.seasonId,
    recipientId: g.recipientId,
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
    giverIds: [...giverIds].sort((a, b) => a - b),
    createdBy: g.createdBy,
    updatedBy: g.updatedBy,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}
