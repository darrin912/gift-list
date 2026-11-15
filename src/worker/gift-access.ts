// Gift reads that always apply the surprise rule. Routes must load gifts through
// these helpers rather than querying the gifts table directly.
import { eq, inArray, type SQL } from "drizzle-orm";
import { giftGivers, gifts, seasons, type GiftRow, type SeasonRow } from "../db/schema";
import { notFound } from "./http";
import { isGiftHidden } from "./rules";
import type { ApiUser, Variables } from "./types";

type Db = Variables["db"];

export interface GiftWithSeason {
  gift: GiftRow;
  season: SeasonRow | null;
}

/** D1 allows at most 100 bound parameters per statement. */
const CHUNK = 90;

/** Gifts matching `where`, minus any hidden from `viewer` by the surprise rule. */
export async function loadVisibleGifts(
  db: Db,
  viewer: ApiUser,
  today: string,
  where?: SQL,
): Promise<GiftWithSeason[]> {
  const rows = await db
    .select({ gift: gifts, season: seasons })
    .from(gifts)
    .leftJoin(seasons, eq(seasons.id, gifts.seasonId))
    .where(where)
    .all();
  return rows.filter((r) => !isGiftHidden(r.gift, r.season, viewer.personId, today));
}

/** One gift by id, or a 404 if it doesn't exist or is hidden from `viewer`. */
export async function getVisibleGift(db: Db, viewer: ApiUser, today: string, id: number): Promise<GiftWithSeason> {
  const [row] = await loadVisibleGifts(db, viewer, today, eq(gifts.id, id));
  if (!row) notFound("Gift not found");
  return row;
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
