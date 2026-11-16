// Activity log: human-readable summaries (written at change time, with names resolved then)
// and the feed, which applies the surprise rule from rules.ts.
import { and, desc, eq, lt, type SQL } from "drizzle-orm";
import { activityLog, seasons, users, type GiftRow, type GiftStatus } from "../db/schema";
import { hiddenGiftIds, type GiftWithRecipients } from "./gift-access";
import { PRICE_WATCH_ACTOR, PRICE_WATCH_USER_NAME } from "./price-watch";
import { isGiftHidden } from "./rules";
import type { ApiUser, Variables } from "./types";

type Db = Variables["db"];

// ---------------------------------------------------------------- summaries

const STATUS_WORDS: Record<GiftStatus, string> = {
  idea: "an idea",
  planned: "planned",
  ordered: "ordered",
  received: "received",
  wrapped: "wrapped",
  given: "given",
  returned: "returned",
};

const FIELD_LABELS: Partial<Record<keyof GiftRow | "giverIds", string>> = {
  description: "description",
  url: "link",
  imageUrl: "image",
  category: "category",
  wished: "wish list",
  priority: "priority",
  estPriceCents: "price",
  actualPriceCents: "price",
  store: "store",
  orderNumber: "order number",
  trackingUrl: "tracking",
  returnBy: "return-by date",
  watchPrice: "price watch",
  giverIds: "from",
  seasonId: "season",
};

const q = (title: string) => `"${title}"`;

/**
 * Who a gift is for, in words: "Ava", "Ava & Ben", or "the family". Names are passed in the
 * order to show them (callers sort by person id).
 */
export function recipientLabel(names: readonly string[], isFamily: boolean): string {
  if (isFamily) return "the family";
  return names.length ? names.join(" & ") : "someone";
}

export function createdSummary(title: string, recipientLabel: string): string {
  return `Added ${q(title)} for ${recipientLabel}`;
}

export function deletedSummary(title: string, recipientLabel: string): string {
  return `Deleted ${q(title)} for ${recipientLabel}`;
}

export function wishAddedSummary(title: string): string {
  return `Added ${q(title)} to their wishlist`;
}

export function wishUpdatedSummary(title: string): string {
  return `Updated wishlist item ${q(title)}`;
}

export function wishRemovedSummary(title: string): string {
  return `Removed ${q(title)} from their wishlist`;
}

export function importedSummary(n: number): string {
  return `Imported ${n} ${n === 1 ? "gift" : "gifts"}`;
}

/**
 * Summary for a gift update, or null when nothing actually changed.
 * Status changes get their own wording (`Marked "X" as wrapped`).
 */
export function updatedSummary(
  before: GiftWithRecipients,
  after: GiftWithRecipients,
  names: { recipient: string },
  givers?: { before: number[]; after: number[] },
): string | null {
  const changed = (Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]).filter((k) => {
    if (k === "giverIds") {
      if (!givers) return false;
      const a = [...givers.before].sort((x, y) => x - y).join(",");
      const b = [...givers.after].sort((x, y) => x - y).join(",");
      return a !== b;
    }
    return before[k] !== after[k];
  });
  const statusChanged = before.status !== after.status;
  const titleChanged = before.title !== after.title;
  const recipientChanged =
    before.isFamily !== after.isFamily ||
    [...before.recipientIds].sort((a, b) => a - b).join(",") !== [...after.recipientIds].sort((a, b) => a - b).join(",");
  if (statusChanged) {
    return `Marked ${q(after.title)} as ${STATUS_WORDS[after.status]}`;
  }
  if (recipientChanged) return `Moved ${q(after.title)} to ${names.recipient}`;
  if (titleChanged) return `Renamed ${q(before.title)} to ${q(after.title)} for ${names.recipient}`;
  if (changed.length === 0) return null;
  const labels = [...new Set(changed.map((k) => FIELD_LABELS[k]!))];
  return `Updated ${labels.join(", ")} on ${q(after.title)} for ${names.recipient}`;
}

export function logGiftActivity(
  db: Db,
  userId: number,
  action: "create" | "update" | "delete",
  gift: Pick<GiftWithRecipients, "id" | "recipientIds" | "isFamily" | "seasonId">,
  summary: string,
) {
  const recipientIds = gift.isFamily ? [] : [...gift.recipientIds].sort((a, b) => a - b);
  return db.insert(activityLog).values({
    userId,
    giftId: gift.id,
    recipientId: recipientIds[0] ?? null,
    recipientIds,
    seasonId: gift.seasonId,
    action,
    summary,
    at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------- feed

export interface ActivityItem {
  id: number;
  userId: number | null;
  userName: string;
  action: "created" | "updated" | "deleted";
  summary: string;
  giftId: number | null;
  /** The first logged recipient (legacy); prefer recipientIds. */
  recipientId: number | null;
  /** The gift's recipients when the row was logged; [] for family gifts and rows not about one gift. */
  recipientIds: number[];
  seasonId: number | null;
  at: string;
}

/** recipient_ids, falling back to the legacy recipient_id for rows that predate it. */
function loggedRecipientIds(log: { recipientIds: number[] | null; recipientId: number | null }): number[] {
  if (Array.isArray(log.recipientIds)) return log.recipientIds.filter((x) => typeof x === "number");
  return log.recipientId != null ? [log.recipientId] : [];
}

const ACTION_WORDS = { create: "created", update: "updated", delete: "deleted" } as const;

/**
 * Newest-first activity, leaving out every row about a gift hidden from `viewer`.
 * A row is hidden if the gift was hidden as logged (its recipient/season at the time) OR, if
 * the gift still exists, as it is now (so moving a gift to someone or into a live season
 * also hides its history from them).
 */
export async function loadActivity(
  db: Db,
  viewer: ApiUser,
  today: string,
  opts: { limit: number; seasonId?: number },
): Promise<ActivityItem[]> {
  const out: ActivityItem[] = [];
  const pageSize = Math.max(opts.limit * 2, 50);
  let cursor: number | undefined;
  for (let page = 0; page < 20 && out.length < opts.limit; page++) {
    const conds: SQL[] = [];
    if (opts.seasonId !== undefined) conds.push(eq(activityLog.seasonId, opts.seasonId));
    if (cursor !== undefined) conds.push(lt(activityLog.id, cursor));
    const rows = await db
      .select({ log: activityLog, userName: users.displayName, season: seasons })
      .from(activityLog)
      .leftJoin(users, eq(users.id, activityLog.userId))
      .leftJoin(seasons, eq(seasons.id, activityLog.seasonId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(activityLog.id))
      .limit(pageSize)
      .all();
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.log.id;

    // Current state of the gifts these rows are about.
    const giftIds = [...new Set(rows.map((r) => r.log.giftId).filter((x): x is number => x != null))];
    const hiddenNow = await hiddenGiftIds(db, viewer, today, giftIds);

    for (const { log, userName, season } of rows) {
      const loggedIds = loggedRecipientIds(log);
      // A logged season id whose season no longer exists counts as "no season" (hidden).
      if (isGiftHidden({ recipientIds: loggedIds, isFamily: false }, log.seasonId == null ? null : season, viewer.personId, today)) {
        continue;
      }
      if (log.giftId != null && hiddenNow.has(log.giftId)) continue;
      out.push({
        id: log.id,
        userId: log.userId,
        userName: log.systemActor === PRICE_WATCH_ACTOR ? PRICE_WATCH_USER_NAME : (userName ?? ""),
        action: ACTION_WORDS[log.action],
        summary: log.summary,
        giftId: log.giftId,
        recipientId: log.recipientId,
        recipientIds: loggedIds,
        seasonId: log.seasonId,
        at: log.at,
      });
      if (out.length >= opts.limit) break;
    }
    if (rows.length < pageSize) break;
  }
  return out;
}
