// Gift reads that always apply the surprise rule. Routes must load gifts through
// these helpers rather than querying the gifts table directly.
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { giftGivers, giftRecipients, gifts, seasons, type GiftRow, type SeasonRow } from "../db/schema";
import { notFound } from "./http";
import { isGiftHidden } from "./rules";
import type { ApiUser, Variables } from "./types";

type Db = Variables["db"];

/** A gift row plus its recipients (sorted ascending; empty for family gifts). */
export type GiftWithRecipients = GiftRow & { recipientIds: number[] };

export interface GiftWithSeason {
  gift: GiftWithRecipients;
  season: SeasonRow | null;
}

/** D1 allows at most 100 bound parameters per statement. */
const CHUNK = 90;

/** The gift's recipient ids as a JSON array, computed in the same query as the gift. */
const recipientIdsJson = sql<string>`(SELECT json_group_array(${giftRecipients.personId}) FROM ${giftRecipients} WHERE ${giftRecipients.giftId} = ${gifts.id})`;

export function parseRecipientIds(json: string | null | undefined): number[] {
  if (!json) return [];
  const ids = JSON.parse(json) as unknown;
  return Array.isArray(ids) ? ids.filter((x): x is number => typeof x === "number").sort((a, b) => a - b) : [];
}

/** SQL condition: `personId` is one of the gift's recipients. */
export function hasRecipient(personId: number): SQL {
  return sql`EXISTS (SELECT 1 FROM ${giftRecipients} WHERE ${giftRecipients.giftId} = ${gifts.id} AND ${giftRecipients.personId} = ${personId})`;
}

/** SQL condition: any of `personIds` is one of the gift's recipients. */
export function hasAnyRecipient(personIds: number[]): SQL {
  if (personIds.length === 0) return sql`0`;
  return sql`EXISTS (SELECT 1 FROM ${giftRecipients} WHERE ${giftRecipients.giftId} = ${gifts.id} AND ${inArray(giftRecipients.personId, personIds)})`;
}

/**
 * Gifts matching `where` (with their recipients), minus any hidden from `viewer` by the surprise
 * rule. This is the one place the surprise rule is applied to gift reads.
 */
export async function loadVisibleGifts(
  db: Db,
  viewer: ApiUser,
  today: string,
  where?: SQL,
): Promise<GiftWithSeason[]> {
  const rows = await db
    .select({ gift: gifts, season: seasons, recipientIds: recipientIdsJson })
    .from(gifts)
    .leftJoin(seasons, eq(seasons.id, gifts.seasonId))
    .where(where)
    .all();
  const out: GiftWithSeason[] = [];
  for (const r of rows) {
    const gift = { ...r.gift, recipientIds: parseRecipientIds(r.recipientIds) };
    if (!isGiftHidden(gift, r.season, viewer.personId, today)) out.push({ gift, season: r.season });
  }
  return out;
}

/** One gift by id, or a 404 if it doesn't exist or is hidden from `viewer`. */
export async function getVisibleGift(db: Db, viewer: ApiUser, today: string, id: number): Promise<GiftWithSeason> {
  const [row] = await loadVisibleGifts(db, viewer, today, eq(gifts.id, id));
  if (!row) notFound("Gift not found");
  return row;
}

/**
 * Gift ids (out of `giftIds`) that are hidden from `viewer` as the gifts are now. Gifts that no
 * longer exist aren't included.
 */
export async function hiddenGiftIds(db: Db, viewer: ApiUser, today: string, giftIds: number[]): Promise<Set<number>> {
  const hidden = new Set<number>();
  if (viewer.personId == null) return hidden;
  for (let i = 0; i < giftIds.length; i += CHUNK) {
    const rows = await db
      .select({ id: gifts.id, isFamily: gifts.isFamily, season: seasons, recipientIds: recipientIdsJson })
      .from(gifts)
      .leftJoin(seasons, eq(seasons.id, gifts.seasonId))
      .where(and(inArray(gifts.id, giftIds.slice(i, i + CHUNK)), hasRecipient(viewer.personId)))
      .all();
    for (const g of rows) {
      if (isGiftHidden({ isFamily: g.isFamily, recipientIds: parseRecipientIds(g.recipientIds) }, g.season, viewer.personId, today)) {
        hidden.add(g.id);
      }
    }
  }
  return hidden;
}

export async function loadGiverIds(db: Db, giftIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  for (let i = 0; i < giftIds.length; i += CHUNK) {
    const chunk = giftIds.slice(i, i + CHUNK);
    const rows = await db.select().from(giftGivers).where(inArray(giftGivers.giftId, chunk)).all();
    for (const r of rows) {
      const list = map.get(r.giftId) ?? [];
      list.push(r.personId);
      map.set(r.giftId, list);
    }
  }
  return map;
}

export async function loadRecipientIds(db: Db, giftId: number): Promise<number[]> {
  const rows = await db.select({ personId: giftRecipients.personId }).from(giftRecipients).where(eq(giftRecipients.giftId, giftId)).all();
  return rows.map((r) => r.personId).sort((a, b) => a - b);
}
