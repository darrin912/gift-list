// Pure helpers for the Phase 2 Christmas lists (shopping, wrapping, givers, gifts table).
// Everything here is computed client-side from /gifts + /people (see docs/API.md).
import type { Gift, GiftStatus, LinkPreview, Person } from "../api";
import { effectivePriceCents } from "./format";

export const ANYWHERE = "Anywhere";

export interface StoreGroup {
  store: string;
  gifts: Gift[];
  subtotalCents: number;
}

/**
 * Groups gifts by store for the shopping list. Store names are trimmed and grouped
 * case-insensitively (the first spelling seen wins). Gifts with no store go in a final
 * "Anywhere" group. Groups are sorted by most gifts, then name; gifts by recipient then title.
 */
export function groupByStore(gifts: Gift[], recipientName: (id: number) => string = () => ""): StoreGroup[] {
  const groups = new Map<string, StoreGroup>();
  for (const g of gifts) {
    const raw = (g.store ?? "").trim();
    const key = raw ? raw.toLowerCase() : "";
    let grp = groups.get(key);
    if (!grp) {
      grp = { store: raw || ANYWHERE, gifts: [], subtotalCents: 0 };
      groups.set(key, grp);
    }
    grp.gifts.push(g);
    grp.subtotalCents += effectivePriceCents(g);
  }
  const anywhere = groups.get("");
  groups.delete("");
  const sorted = [...groups.values()].sort((a, b) => b.gifts.length - a.gifts.length || a.store.localeCompare(b.store));
  if (anywhere) sorted.push(anywhere);
  for (const grp of sorted) {
    grp.gifts.sort((a, b) => recipientName(a.recipientId).localeCompare(recipientName(b.recipientId)) || a.title.localeCompare(b.title));
  }
  return sorted;
}

/** Sum of effective prices. */
export function sumCents(gifts: Gift[]): number {
  return gifts.reduce((s, g) => s + effectivePriceCents(g), 0);
}

export interface RecipientGroup {
  recipientId: number;
  gifts: Gift[];
}

/** Groups gifts by recipient, keeping `order` (person ids) first and anyone else after. */
export function groupByRecipient(gifts: Gift[], order: number[] = []): RecipientGroup[] {
  const m = new Map<number, Gift[]>();
  for (const g of gifts) {
    const list = m.get(g.recipientId) ?? [];
    list.push(g);
    m.set(g.recipientId, list);
  }
  const rank = (id: number) => {
    const i = order.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...m.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a - b)
    .map(([recipientId, list]) => ({ recipientId, gifts: list.sort((x, y) => x.title.localeCompare(y.title)) }));
}

export interface WrapProgress {
  toWrap: number;
  wrapped: number;
  given: number;
  /** Gifts that are here (received or later), the denominator for "wrapped". */
  here: number;
}

/** Counts for the wrapping and Christmas Eve page. */
export function wrapProgress(gifts: Gift[]): WrapProgress {
  let toWrap = 0;
  let wrapped = 0;
  let given = 0;
  for (const g of gifts) {
    if (g.status === "received") toWrap++;
    else if (g.status === "wrapped") wrapped++;
    else if (g.status === "given") given++;
  }
  return { toWrap, wrapped, given, here: toWrap + wrapped + given };
}

export interface GiversMatrix {
  givers: Person[];
  recipients: Person[];
  /** `${giverId}:${recipientId}` → gifts from that giver to that recipient. */
  cells: Map<string, Gift[]>;
}

export const cellKey = (giverId: number, recipientId: number) => `${giverId}:${recipientId}`;

/**
 * Givers checklist: rows are kids (givers), columns are family members (parents and kids;
 * Santa and other kinds are left out). A gift counts in every row whose kid is in `giverIds`.
 * Returned gifts don't count. Archived people are left out. The diagonal (a kid to themself)
 * is never filled. Hidden gifts never reach the client, so their cells just look empty.
 */
export function buildGiversMatrix(gifts: Gift[], people: Person[]): GiversMatrix {
  const active = people.filter((p) => !p.archived).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const givers = active.filter((p) => p.kind === "kid");
  const recipients = [...active.filter((p) => p.kind === "parent"), ...givers];
  const giverIds = new Set(givers.map((p) => p.id));
  const recipientIds = new Set(recipients.map((p) => p.id));
  const cells = new Map<string, Gift[]>();
  for (const g of gifts) {
    if (g.status === "returned" || !recipientIds.has(g.recipientId)) continue;
    for (const giver of new Set(g.giverIds)) {
      if (!giverIds.has(giver) || giver === g.recipientId) continue;
      const k = cellKey(giver, g.recipientId);
      const list = cells.get(k) ?? [];
      list.push(g);
      cells.set(k, list);
    }
  }
  return { givers, recipients, cells };
}

/** Number of giver × recipient pairs (excluding self) that still have no gift. */
export function emptyCellCount(m: GiversMatrix, skipRecipientId?: number | null): number {
  let n = 0;
  for (const g of m.givers)
    for (const r of m.recipients) if (g.id !== r.id && r.id !== skipRecipientId && !m.cells.get(cellKey(g.id, r.id))?.length) n++;
  return n;
}

// ---- Gifts table sorting ----

export type SortKey = "title" | "recipient" | "status" | "price" | "store";
export type SortDir = "asc" | "desc";

const STATUS_ORDER: GiftStatus[] = ["idea", "planned", "ordered", "received", "wrapped", "given", "returned"];

/** Stable sort for the gifts table. Empty stores sort last in either direction. */
export function sortGifts(gifts: Gift[], key: SortKey, dir: SortDir, recipientName: (id: number) => string): Gift[] {
  const sign = dir === "asc" ? 1 : -1;
  const cmp = (a: Gift, b: Gift): number => {
    switch (key) {
      case "title":
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      case "recipient":
        return recipientName(a.recipientId).localeCompare(recipientName(b.recipientId));
      case "status":
        return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
      case "price":
        return effectivePriceCents(a) - effectivePriceCents(b);
      case "store":
        return (a.store ?? "").localeCompare(b.store ?? "", undefined, { sensitivity: "base" });
    }
  };
  return gifts
    .map((g, i) => ({ g, i }))
    .sort((x, y) => {
      if (key === "store") {
        const ex = !(x.g.store ?? "").trim();
        const ey = !(y.g.store ?? "").trim();
        if (ex !== ey) return ex ? 1 : -1;
      }
      return sign * cmp(x.g, y.g) || x.i - y.i;
    })
    .map((x) => x.g);
}

// ---- Link preview (auto-fill) ----

export interface PreviewTarget {
  title: string;
  imageUrl: string;
  est: string;
  store: string;
}

/**
 * Applies a link preview to the gift form, filling only empty fields.
 * Returns the new values and the names of the fields that changed.
 */
export function mergePreview<T extends PreviewTarget>(form: T, p: LinkPreview, centsToInput: (c: number | null) => string): { next: T; filled: (keyof PreviewTarget)[] } {
  const next = { ...form };
  const filled: (keyof PreviewTarget)[] = [];
  const put = (k: keyof PreviewTarget, v: string) => {
    if (!form[k].trim() && v.trim()) {
      (next as PreviewTarget)[k] = v.trim();
      filled.push(k);
    }
  };
  put("title", p.title ?? "");
  put("imageUrl", p.imageUrl ?? "");
  if (p.priceCents !== null && p.priceCents !== undefined && p.priceCents > 0) put("est", centsToInput(p.priceCents));
  put("store", p.store ?? "");
  return { next, filled };
}

/** True when pasted text looks like a single web link worth auto-filling from. */
export function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return false;
  try {
    new URL(t);
    return true;
  } catch {
    return false;
  }
}
