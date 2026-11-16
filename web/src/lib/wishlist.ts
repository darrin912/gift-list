// Phase 4: My wishlist helpers. Names always come from data (GET /users display names),
// never from hard-coded people.
import type { Gift, Season, UserSummary, WishInput, WishItem } from "../api";
import { centsToInput, isHttpUrl, parseDollars } from "./format";

/** "Darrin" → "Darrin's". */
export function possessive(name: string): string {
  return `${name}’s`;
}

/** The display name of whoever's wishlist this gift came from, or null when it isn't a wishlist item. */
export function wishOwnerName(gift: Pick<Gift, "isWishlistItem" | "createdBy">, users: readonly UserSummary[]): string | null {
  if (!gift.isWishlistItem) return null;
  return users.find((u) => u.id === gift.createdBy)?.displayName?.trim() || null;
}

/** "🎁 From Darrin's wishlist" (the emoji is added by the badge). */
export function wishBadgeText(ownerName: string | null): string {
  return ownerName ? `From ${possessive(ownerName)} wishlist` : "From their wishlist";
}

/** The other signed-in users' names ("Stephanie", "Stephanie & Sam"), or null if there are none yet. */
export function otherUsersLabel(users: readonly UserSummary[], meId: number | undefined): string | null {
  const names = users.filter((u) => u.id !== meId).map((u) => u.displayName.trim()).filter(Boolean);
  if (!names.length) return null;
  if (names.length <= 2) return names.join(" & ");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

export function removeConfirmText(others: string | null): string {
  return `${others ?? "Your family"} will see that you no longer want this.`;
}

export function emptyWishlistText(others: string | null): string {
  const who = others ?? "Your family";
  return `Add things you'd love. ${who} ${who.includes("&") ? "see" : "sees"} them; you'll never see if they were bought.`;
}

/** Creating a gift for yourself alone: the form suggests My wishlist instead. */
export function isForSelfOnly(f: { isFamily: boolean; recipientIds: readonly number[] }, myPersonId: number | null | undefined): boolean {
  return myPersonId != null && !f.isFamily && f.recipientIds.length === 1 && f.recipientIds[0] === myPersonId;
}

/** Seasons a wish can be filed under: not archived and not past (the server enforces the same). */
export function wishSeasons(seasons: readonly Season[], today: string): Season[] {
  return seasons.filter((s) => !s.archived && !!s.date && s.date >= today);
}

/** Today in UTC (the server's surprise rule uses the UTC date). */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface WishForm {
  title: string;
  url: string;
  imageUrl: string;
  est: string;
  /** Only used to merge link previews; not part of a wish. */
  store: string;
  description: string;
  priority: 1 | 2 | 3;
  category: WishItem["category"];
  seasonId: number | null;
}

export function wishFormFrom(w?: WishItem): WishForm {
  return {
    title: w?.title ?? "",
    url: w?.url ?? "",
    imageUrl: w?.imageUrl ?? "",
    est: centsToInput(w?.estPriceCents),
    store: "",
    description: w?.description ?? "",
    priority: w?.priority ?? 2,
    category: w?.category ?? "main",
    seasonId: w?.seasonId ?? null,
  };
}

/** Validates a wish form; returns the request body or an error message for the person. */
export function wishInputFrom(f: WishForm): { input: WishInput & { title: string } } | { error: string } {
  const title = f.title.trim();
  if (!title) return { error: "What would you love?" };
  const est = parseDollars(f.est);
  if (Number.isNaN(est)) return { error: "Enter the price in dollars, like 24.99." };
  for (const [label, v] of [
    ["Link", f.url],
    ["Image URL", f.imageUrl],
  ] as const) {
    if (v.trim() && !isHttpUrl(v.trim())) return { error: `${label} must start with http:// or https://.` };
  }
  return {
    input: {
      title,
      url: f.url.trim(),
      imageUrl: f.imageUrl.trim(),
      description: f.description,
      priority: f.priority,
      category: f.category,
      estPriceCents: est,
      seasonId: f.seasonId,
    },
  };
}

/** Only the fields that changed, so an edit doesn't resend everything. */
export function wishChanges(before: WishItem, input: WishInput): WishInput {
  const out: WishInput = {};
  for (const k of Object.keys(input) as (keyof WishInput)[]) {
    if (input[k] !== before[k]) (out as Record<string, unknown>)[k] = input[k];
  }
  return out;
}

/** "shop.example.com" for showing a link compactly. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
