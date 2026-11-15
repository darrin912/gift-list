// Phase 3 part C: gifts for several people and family gifts (see docs/API.md).
// Pure helpers shared by every page that shows who a gift is for.
import type { Gift, Person } from "../api";
import { formatCents } from "./format";

/** Anything that names its recipients: a Gift, or a row from the dashboard / activity. */
export interface RecipientsLike {
  recipientIds?: number[] | null;
  isFamily?: boolean | null;
  /** Pre-part-C servers (and some summary rows) still send a single id. */
  recipientId?: number | null;
}

/** The person ids a gift is for (empty for family gifts). Tolerates the old single `recipientId`. */
export function giftRecipientIds(g: RecipientsLike): number[] {
  if (g.isFamily) return [];
  if (Array.isArray(g.recipientIds)) return g.recipientIds;
  return typeof g.recipientId === "number" ? [g.recipientId] : [];
}

export const isFamilyGift = (g: RecipientsLike): boolean => g.isFamily === true;

/** True when the gift is for this person (any match; family gifts are for no one person). */
export const isForPerson = (g: RecipientsLike, personId: number): boolean => giftRecipientIds(g).includes(personId);

/** True for a gift shared by more than one person. */
export const isShared = (g: RecipientsLike): boolean => giftRecipientIds(g).length > 1;

/** "Ava", "Ava & Ben", "Ava, Ben & Cal". */
export function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(" & ");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** People in display order: their sort order, then name, then id. Unknown ids go last. */
export function orderedRecipients(ids: number[], map: Map<number, Person>): (Person | undefined)[] {
  const uniq = [...new Set(ids)];
  return uniq
    .map((id) => ({ id, p: map.get(id) }))
    .sort((a, b) => {
      if (!a.p || !b.p) return a.p ? -1 : b.p ? 1 : a.id - b.id;
      return a.p.sortOrder - b.p.sortOrder || a.p.name.localeCompare(b.p.name) || a.id - b.id;
    })
    .map((x) => x.p);
}

export const FAMILY_LABEL = "🏠 Family";

/**
 * "Ava & Ben" or "🏠 Family". With `emoji`, a lone recipient's emoji is shown in front ("🦄 Ava").
 * `family` overrides the family wording (e.g. "the family").
 */
export function recipientLabel(g: RecipientsLike, map: Map<number, Person>, opts: { emoji?: boolean; family?: string } = {}): string {
  if (isFamilyGift(g)) return opts.family ?? FAMILY_LABEL;
  const people = orderedRecipients(giftRecipientIds(g), map);
  if (!people.length) return "Unknown";
  if (people.length === 1) {
    const p = people[0];
    if (!p) return "Unknown";
    return opts.emoji && p.emoji ? `${p.emoji} ${p.name}` : p.name;
  }
  return joinNames(people.map((p) => p?.name ?? "Unknown"));
}

/** A sortable key: the label without emoji. Family sorts after people. */
export function recipientSortKey(g: RecipientsLike, map: Map<number, Person>): string {
  return isFamilyGift(g) ? "￿Family" : recipientLabel(g, map);
}

/** Accent color: the lone recipient's color; otherwise a neutral line (gold for family). */
export function recipientColor(g: RecipientsLike, map: Map<number, Person>): string {
  if (isFamilyGift(g)) return "var(--gold)";
  const ids = giftRecipientIds(g);
  if (ids.length === 1) return map.get(ids[0])?.color || "var(--line)";
  return "var(--line)";
}

// ---------- Money split ----------

/**
 * Each recipient's share of `priceCents`, like the server: floor(price / n) each, and the
 * remainder cents go one each to recipients in ascending person id order.
 */
export function splitShares(priceCents: number, ids: number[]): Map<number, number> {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const out = new Map<number, number>();
  const n = sorted.length;
  if (!n) return out;
  const base = Math.floor(priceCents / n);
  const rem = priceCents - base * n;
  sorted.forEach((id, i) => out.set(id, base + (i < rem ? 1 : 0)));
  return out;
}

/** One person's share of a gift (0 when they aren't a recipient or it's a family gift). */
export function shareFor(priceCents: number, g: RecipientsLike, personId: number): number {
  return splitShares(priceCents, giftRecipientIds(g)).get(personId) ?? 0;
}

/** "$150 each" / "$33.33–$33.34 each"; null when there's nothing to split. */
export function splitHint(priceCents: number | null, ids: number[]): string | null {
  const n = new Set(ids).size;
  if (n < 2 || priceCents === null || !Number.isFinite(priceCents) || priceCents <= 0) return null;
  const shares = [...splitShares(priceCents, ids).values()];
  const lo = Math.min(...shares);
  const hi = Math.max(...shares);
  return lo === hi ? `${formatCents(lo)} each` : `${formatCents(lo)}–${formatCents(hi)} each`;
}

// ---------- Gift form "For" state ----------

export interface ForState {
  recipientIds: number[];
  isFamily: boolean;
}

/** Toggle one person. Picking a person clears "Whole family". */
export function toggleRecipient(s: ForState, id: number): ForState {
  const on = s.recipientIds.includes(id);
  return { isFamily: false, recipientIds: on ? s.recipientIds.filter((x) => x !== id) : [...s.recipientIds, id] };
}

/** Toggle "Whole family". Turning it on clears every person. */
export function toggleFamily(s: ForState): ForState {
  return s.isFamily ? { isFamily: false, recipientIds: [] } : { isFamily: true, recipientIds: [] };
}

/** null when valid, else a message (mirrors the server's 400 rules). */
export function forStateError(s: ForState): string | null {
  if (s.isFamily) return s.recipientIds.length ? "A family gift can't also be for people." : null;
  const n = new Set(s.recipientIds).size;
  if (n === 0) return "Choose who the gift is for.";
  if (n > 10) return "A gift can be for up to 10 people.";
  return null;
}

const ids = (s: string | null): number[] =>
  (s ?? "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

/**
 * Prefill from the URL: `?family=1`, `?recipientIds=1,2`, or the older `?recipient=1` /
 * `?recipientId=1` (also `recipient=family`).
 */
export function forFromParams(sp: URLSearchParams): ForState {
  if (sp.get("family") === "1" || sp.get("recipient") === "family" || sp.get("recipientId") === "family") return { isFamily: true, recipientIds: [] };
  const list = [...ids(sp.get("recipientIds")), ...ids(sp.get("recipientId")), ...ids(sp.get("recipient"))];
  return { isFamily: false, recipientIds: [...new Set(list)] };
}

/** Query string for the gift form prefilled with these recipients. */
export function forQuery(s: ForState): string {
  if (s.isFamily) return "family=1";
  if (!s.recipientIds.length) return "";
  return `recipientIds=${s.recipientIds.join(",")}`;
}

/** Gift-list "For" filter value from the URL: a person id, "family", or undefined. */
export function recipientFilterValue(v: string | null): number | "family" | undefined {
  if (!v) return undefined;
  if (v === "family") return "family";
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Client-side check of the gift-list "For" filter (any recipient matches; "family" = family gifts). */
export function matchesRecipientFilter(g: Pick<Gift, "recipientIds" | "isFamily">, f: number | "family" | undefined): boolean {
  if (f === undefined) return true;
  if (f === "family") return isFamilyGift(g);
  return isForPerson(g, f);
}

/** CSV import preview: the `recipient` cell, with "Family" (any case) shown as "🏠 Family". */
export function csvRecipientLabel(cell: string): string {
  return cell.trim().toLowerCase() === "family" ? FAMILY_LABEL : cell;
}
