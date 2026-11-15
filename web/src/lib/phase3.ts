// Pure helpers for Phase 3 part A: "given before" hints, birthdays, the name draw,
// season grouping, price watch, and passkeys. All tested in phase3.test.ts.
import type { DrawPair, Gift, Person, Season, SimilarGift } from "../api";
import { ApiError } from "../api";
import { daysUntil, formatCents, todayISO } from "./format";

// ---------- "Given before" ----------

/** The server's title normalization: lowercase, punctuation stripped, whitespace collapsed. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Only ask the server once the title is long enough to match (both sides need ≥ 4 chars). */
export function canCheckSimilar(title: string): boolean {
  return normalizeTitle(title).length >= 4;
}

export interface SimilarHint {
  /** "Looks like Ava got" / "Looks like Ava is getting" */
  lead: string;
  title: string;
  /** "in Christmas 2025" */
  where: string;
  /** "(and 2 more)" or "" */
  more: string;
  giftId: number;
}

/** The hint for the first match; past seasons read "got", upcoming ones "is getting". */
export function similarHint(items: SimilarGift[], recipientName: string, today: string = todayISO()): SimilarHint | null {
  if (!items.length) return null;
  const first = items[0];
  const future = first.seasonDate !== null && first.seasonDate >= today;
  const who = recipientName || "They";
  return {
    lead: `Looks like ${who} ${future ? "is already getting" : "got"}`,
    title: first.title,
    where: `in ${first.seasonName}`,
    more: items.length > 1 ? `(and ${items.length - 1} more)` : "",
    giftId: first.giftId,
  };
}

/** One-line text version of the hint (screen readers, tests). */
export function similarHintText(items: SimilarGift[], recipientName: string, today?: string): string {
  const h = similarHint(items, recipientName, today);
  if (!h) return "";
  return `🔁 ${h.lead} “${h.title}” ${h.where}${h.more ? ` ${h.more}` : ""}`;
}

// ---------- History ----------

/** History entries grouped by the year of the season's date (newest first, order preserved). */
export function groupHistoryByYear<T extends { season: Season }>(entries: T[]): { year: string; entries: T[] }[] {
  const out: { year: string; entries: T[] }[] = [];
  for (const e of entries) {
    const year = e.season.date?.slice(0, 4) || e.season.name.match(/\b(19|20)\d{2}\b/)?.[0] || "Earlier";
    const last = out[out.length - 1];
    if (last && last.year === year) last.entries.push(e);
    else out.push({ year, entries: [e] });
  }
  return out;
}

// ---------- Birthdays ----------

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const pad = (n: number) => String(n).padStart(2, "0");

export interface NextBirthday {
  /** YYYY-MM-DD of the next birthday (today counts). Feb 29 falls on Feb 28 in common years. */
  date: string;
  days: number;
  /** Age they turn, when the birth year is known. */
  turning: number | null;
}

export function nextBirthday(birthday: string | null | undefined, today: string = todayISO()): NextBirthday | null {
  const m = birthday?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [by, bm, bd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bm < 1 || bm > 12 || bd < 1 || bd > 31) return null;
  const ty = Number(today.slice(0, 4));
  const on = (y: number) => `${y}-${pad(bm)}-${pad(bm === 2 && bd === 29 && !isLeap(y) ? 28 : bd)}`;
  let year = ty;
  let date = on(year);
  if (date < today) date = on(++year);
  return { date, days: daysUntil(date, today), turning: by > 1900 && by <= year ? year - by : null };
}

/** "Ava's Birthday 2027" (just an apostrophe after a trailing s: "James' Birthday"). */
export function birthdaySeasonName(name: string, date: string): string {
  const n = name.trim();
  return `${n}${/s$/i.test(n) ? "'" : "'s"} Birthday ${date.slice(0, 4)}`;
}

/** People with a birthday within `withinDays` (default 60), soonest first. */
export function upcomingBirthdays(people: Person[], today: string = todayISO(), withinDays = 60): { person: Person; next: NextBirthday }[] {
  return people
    .filter((p) => !p.archived && p.giverOnly !== true)
    .map((person) => ({ person, next: nextBirthday(person.birthday, today) }))
    .filter((x): x is { person: Person; next: NextBirthday } => !!x.next && x.next.days <= withinDays)
    .sort((a, b) => a.next.days - b.next.days);
}

/** "today", "tomorrow", "in 12 days". */
export function inDays(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** An existing birthday season for this person on that date (so "Plan birthday" opens it instead). */
export function findBirthdaySeason(seasons: Season[], personId: number, date: string): Season | undefined {
  return seasons.find((s) => s.kind === "birthday" && s.honoreeId === personId && s.date === date);
}

// ---------- Seasons ----------

export type SeasonGroupKey = "christmas" | "birthday" | "other";
export interface SeasonGroup {
  key: SeasonGroupKey;
  label: string;
  seasons: Season[];
}

/** Season switcher groups: Christmas, Birthdays, Other (anniversaries + other). Empty groups dropped; order kept. */
export function groupSeasons(seasons: Season[]): SeasonGroup[] {
  const groups: SeasonGroup[] = [
    { key: "christmas", label: "Christmas", seasons: [] },
    { key: "birthday", label: "Birthdays", seasons: [] },
    { key: "other", label: "Other", seasons: [] },
  ];
  for (const s of seasons) {
    const key: SeasonGroupKey = s.kind === "christmas" ? "christmas" : s.kind === "birthday" ? "birthday" : "other";
    groups.find((g) => g.key === key)!.seasons.push(s);
  }
  return groups.filter((g) => g.seasons.length);
}

/** Dashboard order for a birthday season: the honoree first, everyone else in their usual order. */
export function honoreeFirst<T extends { personId: number }>(rows: T[], season: Pick<Season, "kind" | "honoreeId"> | undefined): T[] {
  const h = season?.honoreeId;
  if (!h || season?.kind !== "birthday") return rows;
  return [...rows.filter((r) => r.personId === h), ...rows.filter((r) => r.personId !== h)];
}

export const showFairness = (season: Pick<Season, "kind"> | undefined) => season?.kind !== "birthday";

// ---------- Name draw ----------

/** True once a gift in this season goes from the pair's giver to their recipient (returned gifts don't count). */
export function pairHasGift(pair: DrawPair, gifts: Gift[], seasonId: number | undefined): boolean {
  return gifts.some(
    (g) => g.seasonId === seasonId && g.recipientId === pair.recipientId && g.status !== "returned" && g.giverIds.includes(pair.giverId),
  );
}

/** Kids (not archived, not giver-only) are preselected for the draw. */
export function defaultDrawParticipants(people: Person[]): number[] {
  return people.filter((p) => p.kind === "kid" && !p.archived && p.giverOnly !== true).map((p) => p.id);
}

/** Link that opens the gift form prefilled for a draw pair. */
export const drawGiftHref = (p: DrawPair) => `/gifts/new?recipient=${p.recipientId}&from=${p.giverId}`;

// ---------- Price watch ----------

export interface PriceWatchInfo {
  dropped: boolean;
  lowest: string | null;
}

/** "⬇ Price drop" applies to still-unbought gifts; "Lowest $X" whenever a lowest price is known. */
export function priceWatchInfo(g: Pick<Gift, "status" | "watchPrice" | "priceDroppedAt" | "lowestSeenPriceCents">): PriceWatchInfo {
  const open = g.status === "idea" || g.status === "planned";
  return {
    dropped: open && !!g.priceDroppedAt,
    lowest: g.watchPrice && g.lowestSeenPriceCents != null ? `Lowest ${formatCents(g.lowestSeenPriceCents)}` : null,
  };
}

/** Activity rows written by the daily price check have no user. */
export const activityActor = (e: { userId: number | null; userName: string | null }) =>
  e.userId === null || !e.userName ? "Price watch" : e.userName;

// ---------- Passkeys ----------

/** A friendly default name for a new passkey from the user agent: "iPhone", "Mac", "Android phone"… */
export function defaultDeviceName(ua: string): string {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/CrOS/i.test(ua)) return "Chromebook";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux/i.test(ua)) return "Linux computer";
  return "This device";
}

export const supportsPasskeys = () => typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";

/** Turns WebAuthn and API failures into something a person can act on. null = the user cancelled (say nothing loud). */
export function passkeyError(e: unknown, mode: "login" | "register"): { message: string; quiet: boolean } {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  if (name === "NotAllowedError" || name === "AbortError" || code === "ERROR_CEREMONY_ABORTED")
    return { message: mode === "login" ? "Passkey sign-in was cancelled." : "Cancelled. No passkey was added.", quiet: true };
  if (name === "InvalidStateError" || code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED")
    return { message: "This device already has a passkey for your account.", quiet: false };
  if (name === "NotSupportedError" || name === "SecurityError" || code === "ERROR_INVALID_DOMAIN")
    return { message: "Passkeys aren't supported in this browser here. Use your password instead.", quiet: false };
  if (e instanceof ApiError) {
    if (e.status === 429) return { message: "Too many sign-in attempts. Wait 15 minutes, then try again.", quiet: false };
    if (e.status === 401 || e.status === 400)
      return { message: mode === "login" ? "That passkey isn't recognized. Sign in with your password." : e.message, quiet: false };
    return { message: e.message, quiet: false };
  }
  if (e instanceof TypeError) return { message: "Can't reach the server. Check your connection and try again.", quiet: false };
  return { message: mode === "login" ? "Passkey sign-in didn't work. Try your password." : "Couldn't add the passkey. Try again.", quiet: false };
}
