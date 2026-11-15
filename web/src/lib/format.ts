import type { Gift, GiftCategory, GiftStatus, PersonKind, SeasonKind } from "../api";

const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Format integer cents as USD. Whole-dollar amounts drop the ".00". `round` forces whole dollars. */
export function formatCents(cents: number | null | undefined, opts: { round?: boolean } = {}): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return "–";
  if (opts.round || cents % 100 === 0) return usdWhole.format(Math.round(cents / 100));
  return usdCents.format(cents / 100);
}

/**
 * Parse a dollar amount typed by a person ("12", "$12.5", "1,299.99") into integer cents.
 * Returns null for an empty string and NaN for anything that isn't a valid amount.
 */
export function parseDollars(input: string): number | null {
  const s = input.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (s === "") return null;
  if (!/^\d*(\.\d{0,2})?$/.test(s) || s === ".") return NaN;
  const [whole, frac = ""] = s.split(".");
  return Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
}

/** Integer cents to a value for a dollar input ("12" or "12.50"); null becomes "". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  if (cents % 100 === 0) return String(cents / 100);
  return (cents / 100).toFixed(2);
}

/** Effective price: actual if set, else estimate, else 0. */
export function effectivePriceCents(g: Pick<Gift, "actualPriceCents" | "estPriceCents">): number {
  return g.actualPriceCents ?? g.estPriceCents ?? 0;
}

export const STATUS_FLOW: GiftStatus[] = ["idea", "planned", "ordered", "received", "wrapped", "given"];
export const ALL_STATUSES: GiftStatus[] = [...STATUS_FLOW, "returned"];

export const STATUS_LABEL: Record<GiftStatus, string> = {
  idea: "Idea",
  planned: "Planned",
  ordered: "Ordered",
  received: "Received",
  wrapped: "Wrapped",
  given: "Given",
  returned: "Returned",
};

/** The verb on the one-tap advance button for a gift currently in `status`. */
export const ADVANCE_LABEL: Partial<Record<GiftStatus, string>> = {
  idea: "Plan it",
  planned: "Ordered",
  ordered: "Got it",
  received: "Wrapped",
  wrapped: "Given",
};

/** The next status in the idea → given flow, or null at the end (and for returned). */
export function nextStatus(s: GiftStatus): GiftStatus | null {
  const i = STATUS_FLOW.indexOf(s);
  if (i < 0 || i === STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[i + 1];
}

export const CATEGORY_LABEL: Record<GiftCategory, string> = {
  main: "Main",
  stocking: "Stocking",
  experience: "Experience",
  clothing: "Clothing",
  book: "Book",
  other: "Other",
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as GiftCategory[];

export const KIND_LABEL: Record<PersonKind, string> = { parent: "Parent", kid: "Kid", other: "Other" };
export const SEASON_KIND_LABEL: Record<SeasonKind, string> = {
  christmas: "Christmas",
  birthday: "Birthday",
  anniversary: "Anniversary",
  other: "Other",
};

/** Today's date as YYYY-MM-DD in local time. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoToUTC(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `today` to `iso` (negative when past). */
export function daysUntil(iso: string, today: string = todayISO()): number {
  return Math.round((isoToUTC(iso) - isoToUTC(today)) / 86_400_000);
}

/** Return-by warning level, matching the API's rule: red when past, amber within 7 days. */
export function returnLevel(
  returnBy: string | null,
  status: GiftStatus,
  today: string = todayISO(),
): "red" | "amber" | null {
  if (!returnBy || !["ordered", "received", "wrapped"].includes(status)) return null;
  const d = daysUntil(returnBy, today);
  if (d < 0) return "red";
  if (d <= 7) return "amber";
  return null;
}

/** "Dec 25" (adds the year when it isn't `today`'s year). */
export function formatDate(iso: string | null | undefined, today: string = todayISO()): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const base = `${months[m - 1]} ${d}`;
  return String(y) === today.slice(0, 4) ? base : `${base}, ${y}`;
}

/** Human phrasing for a return deadline: "Return closed 2 days ago", "Return by today", "Return in 3 days". */
export function returnPhrase(iso: string, today: string = todayISO()): string {
  const d = daysUntil(iso, today);
  if (d < -1) return `Return window closed ${-d} days ago`;
  if (d === -1) return "Return window closed yesterday";
  if (d === 0) return "Return by today";
  if (d === 1) return "Return by tomorrow";
  return `Return within ${d} days`;
}

/** Fraction 0..1 of `part` over `whole`, clamped; 0 when whole is 0. */
export function ratio(part: number, whole: number): number {
  if (whole <= 0) return part > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, part / whole));
}

/** Basic URL check for link/image fields (http/https only). */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
