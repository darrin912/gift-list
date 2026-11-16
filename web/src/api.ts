// Typed client for the Phase 1–4 API. See docs/API.md (the binding contract).
// Money is always integer cents. Dates are YYYY-MM-DD strings.

export type PersonKind = "parent" | "kid" | "other";
export type SeasonKind = "christmas" | "birthday" | "anniversary" | "other";
export type GiftCategory = "main" | "stocking" | "experience" | "clothing" | "book" | "other";
export type GiftStatus = "idea" | "planned" | "ordered" | "received" | "wrapped" | "given" | "returned";

export interface User {
  id: number;
  email: string;
  displayName: string;
  personId: number | null;
}

export interface Person {
  id: number;
  name: string;
  kind: PersonKind;
  color: string | null;
  emoji: string | null;
  birthday: string | null;
  sizes: Record<string, string>;
  likes: string | null;
  dislikes: string | null;
  notes: string | null;
  sortOrder: number;
  archived: boolean;
  /** A label like Santa: can be a giver ("From") but never a recipient. Missing = false. */
  giverOnly?: boolean;
}
export type PersonInput = Partial<Omit<Person, "id">>;

export interface Season {
  id: number;
  kind: SeasonKind;
  name: string;
  date: string | null;
  overallBudgetCents: number;
  isActive: boolean;
  archived: boolean;
  /** Phase 3: who a birthday (required) or anniversary (optional; null = both parents) is for. */
  honoreeId?: number | null;
  /** Phase 3C: budget for family gifts (missing = 0). */
  familyBudgetCents?: number;
}
export type SeasonInput = Partial<Omit<Season, "id">>;

export interface PersonBudget {
  personId: number;
  budgetCents: number;
  stockingBudgetCents: number;
}

export interface Gift {
  id: number;
  seasonId: number | null;
  /** Phase 3C: who it's for (1–10 people); empty when `isFamily`. */
  recipientIds: number[];
  /** Phase 3C: a gift for the whole family (never a surprise, counts toward no person). */
  isFamily: boolean;
  title: string;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  category: GiftCategory;
  status: GiftStatus;
  wished: boolean;
  priority: 1 | 2 | 3;
  estPriceCents: number | null;
  actualPriceCents: number | null;
  store: string | null;
  orderNumber: string | null;
  trackingUrl: string | null;
  returnBy: string | null;
  giverIds: number[];
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  // Phase 3 price watch (missing on older servers = off / never checked).
  watchPrice?: boolean;
  lastSeenPriceCents?: number | null;
  lowestSeenPriceCents?: number | null;
  lastCheckedAt?: string | null;
  priceDroppedAt?: string | null;
  // Phase 4: someone's own wishlist item (created by them, for them alone, wished). Missing = false.
  isWishlistItem?: boolean;
  /** Phase 4: when the owner removed it from their wishlist ("No longer wanted"). */
  withdrawnAt?: string | null;
}
export type GiftInput = Partial<
  Omit<
    Gift,
    "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt" | "lastSeenPriceCents" | "lowestSeenPriceCents" | "lastCheckedAt" | "priceDroppedAt" | "isWishlistItem" | "withdrawnAt"
  >
>;

export interface GiftFilters {
  /** A season id, or "none" for the ideas inbox. Omit for every season. */
  seasonId?: number | "none";
  /** Any recipient matches; "family" = family gifts. */
  recipientId?: number | "family";
  status?: GiftStatus[];
  store?: string;
  category?: GiftCategory;
  giverId?: number;
  wished?: boolean;
  /** Phase 4: only wishlist items. */
  wishlist?: boolean;
  q?: string;
}

export interface DashboardPerson {
  personId: number;
  hidden: boolean;
  budgetCents: number;
  stockingBudgetCents: number;
  spentCents: number;
  committedCents: number;
  giftCount: number;
  stockingCount: number;
  countsByStatus: Partial<Record<GiftStatus, number>>;
  /** Phase 2: same money rules, stocking gifts only (0 when hidden). Treat missing as 0. */
  stockingSpentCents?: number;
  stockingCommittedCents?: number;
}

/** Who an attention row is for. Part C servers send recipientIds/isFamily; older ones a single recipientId. */
export interface AttentionWho {
  recipientIds?: number[];
  isFamily?: boolean;
  recipientId?: number | null;
}

export interface Dashboard {
  season: Season;
  totals: {
    budgetCents: number;
    spentCents: number;
    committedCents: number;
    remainingCents: number;
    giftCount: number;
    /** Feedback change: sum of person budgets (not archived, not giver-only), incl. the viewer's. */
    allocatedCents?: number;
    /** overallBudgetCents − allocatedCents; negative = over-allocated. */
    unallocatedCents?: number;
  };
  people: DashboardPerson[];
  /** Phase 3C: family gifts (count toward no person). Missing on older servers. */
  family?: { budgetCents: number; spentCents: number; committedCents: number; giftCount: number };
  fairness: { personId: number; spentCents: number; committedCents: number; giftCount: number }[];
  attention: {
    returnsSoon: (AttentionWho & { giftId: number; title: string; returnBy: string; level: "amber" | "red" })[];
    orderedNotReceived: (AttentionWho & { giftId: number; title: string; store: string | null })[];
    receivedNotWrapped: (AttentionWho & { giftId: number; title: string })[];
    /** Phase 4: wishlist items withdrawn after they were bought (a possible return). Missing on older servers. */
    withdrawnWishes?: (AttentionWho & { giftId: number; title: string; status: GiftStatus; store: string | null; withdrawnAt: string })[];
  };
}

// ---- Phase 4: My wishlist ----

/** The owner's view of one of their own wishlist items. Deliberately nothing about planning or buying. */
export interface WishItem {
  id: number;
  title: string;
  description: string;
  url: string;
  imageUrl: string;
  category: GiftCategory;
  priority: 1 | 2 | 3;
  estPriceCents: number | null;
  /** null = no particular occasion (the ideas inbox). */
  seasonId: number | null;
  createdAt: string;
  updatedAt: string;
}
export type WishInput = Partial<Omit<WishItem, "id" | "createdAt" | "updatedAt">>;

/** GET /users: the signed-in users' display names (no emails). */
export interface UserSummary {
  id: number;
  displayName: string;
  personId: number | null;
}

// ---- Phase 2 ----

export type ActivityAction = "created" | "updated" | "deleted";

export interface ActivityEntry {
  id: number;
  /** null for system rows (the daily price watch). */
  userId: number | null;
  userName: string | null;
  action: ActivityAction;
  summary: string;
  giftId: number | null;
  /** Phase 3C rows carry recipientIds; older rows a single recipientId. */
  recipientIds?: number[] | null;
  recipientId?: number | null;
  seasonId: number | null;
  /** ISO timestamp. */
  at: string;
}

export interface LinkPreview {
  title: string;
  imageUrl: string;
  priceCents: number | null;
  store: string;
  /** Present (true) when the remote site refused the request (403/503/captcha). */
  blocked?: boolean;
}

export interface ImportRow {
  line: number;
  ok: boolean;
  error?: string;
  title?: string;
  recipient?: string;
}

export interface ImportResult {
  created: number;
  rows: ImportRow[];
}

export interface ImportRequest {
  csv: string;
  /** A season id, or null for the ideas inbox. */
  seasonId: number | null;
  dryRun: boolean;
}

/** URL of the CSV export: one season, or every gift when seasonId is undefined. */
// ---- Phase 3 (part A) ----

export interface HistorySeason {
  season: Season;
  gifts: Gift[];
}

export interface SimilarGift {
  giftId: number;
  title: string;
  seasonName: string;
  seasonDate: string | null;
  status: GiftStatus;
}

export interface DrawPair {
  giverId: number;
  recipientId: number;
}

export interface DrawResult {
  pairs: DrawPair[];
  /** Set when last season's pairing couldn't be avoided. */
  note?: string;
}

export interface Passkey {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function similarQueryString(opts: { recipientIds: number[]; title: string; excludeId?: number; seasonId?: number | null }): string {
  const p = new URLSearchParams();
  p.set("recipientIds", opts.recipientIds.join(","));
  p.set("title", opts.title);
  if (opts.seasonId != null) p.set("seasonId", String(opts.seasonId));
  if (opts.excludeId !== undefined) p.set("excludeId", String(opts.excludeId));
  return `?${p.toString()}`;
}

/** POST /seasons/:id/draw returns `{ pairs, note? }`; GET returns a bare array. Accept either. */
export function toDrawResult(data: unknown): DrawResult {
  if (Array.isArray(data)) return { pairs: data as DrawPair[] };
  if (data && typeof data === "object" && Array.isArray((data as DrawResult).pairs)) {
    const d = data as DrawResult;
    return d.note ? { pairs: d.pairs, note: d.note } : { pairs: d.pairs };
  }
  return { pairs: [] };
}

export function exportCsvUrl(seasonId?: number): string {
  return `/api/export.csv${seasonId !== undefined ? `?seasonId=${seasonId}` : ""}`;
}

export function activityQueryString(opts: { limit?: number; seasonId?: number }): string {
  const p = new URLSearchParams();
  if (opts.limit !== undefined) p.set("limit", String(opts.limit));
  if (opts.seasonId !== undefined) p.set("seasonId", String(opts.seasonId));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let onUnauthorized: (() => void) | null = null;
/** Called on any 401 (except a failed login) so the app can send the user to the login screen. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    if (res.status === 401 && path !== "/auth/login" && !path.startsWith("/auth/passkey/login")) onUnauthorized?.();
    throw new ApiError(res.status, message);
  }
  return data as T;
}

/**
 * The contract shows bare arrays/objects for most routes. If the server wraps a
 * payload in a single named key (e.g. `{ gift }`), accept that too.
 */
function unwrap<T>(data: unknown, key: string): T {
  if (data && typeof data === "object" && !Array.isArray(data) && key in data) {
    return (data as Record<string, unknown>)[key] as T;
  }
  return data as T;
}

export function giftQueryString(f: GiftFilters): string {
  const p = new URLSearchParams();
  if (f.seasonId !== undefined) p.set("seasonId", String(f.seasonId));
  if (f.recipientId !== undefined) p.set("recipientId", String(f.recipientId));
  if (f.status && f.status.length) p.set("status", f.status.join(","));
  if (f.store) p.set("store", f.store);
  if (f.category) p.set("category", f.category);
  if (f.giverId !== undefined) p.set("giverId", String(f.giverId));
  if (f.wished) p.set("wished", "1");
  if (f.wishlist) p.set("wishlist", "1");
  if (f.q && f.q.trim()) p.set("q", f.q.trim());
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ user: User }>("POST", "/auth/login", { email, password }).then((r) => r.user),
    logout: () => request<{ ok: true }>("POST", "/auth/logout"),
    me: () => request<{ user: User }>("GET", "/auth/me").then((r) => r.user),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: true }>("POST", "/auth/password", { currentPassword, newPassword }),
    passkeys: () => request<unknown>("GET", "/auth/passkeys").then((d) => unwrap<Passkey[]>(d, "passkeys")),
    removePasskey: (id: number) => request<{ ok: true }>("DELETE", `/auth/passkeys/${id}`),
    /** Options JSON for @simplewebauthn/browser (signed in). */
    passkeyRegisterOptions: () => request<unknown>("POST", "/auth/passkey/register/options").then((d) => unwrap<unknown>(d, "options")),
    passkeyRegisterVerify: (response: unknown, name: string) =>
      request<{ ok: boolean }>("POST", "/auth/passkey/register/verify", { response, name }),
    passkeyLoginOptions: () => request<unknown>("POST", "/auth/passkey/login/options").then((d) => unwrap<unknown>(d, "options")),
    passkeyLoginVerify: (response: unknown) =>
      request<{ user: User }>("POST", "/auth/passkey/login/verify", { response }).then((r) => r.user),
  },
  people: {
    list: (includeArchived = false) =>
      request<unknown>("GET", `/people${includeArchived ? "?includeArchived=1" : ""}`).then((d) => unwrap<Person[]>(d, "people")),
    create: (input: PersonInput & { name: string; kind: PersonKind }) =>
      request<unknown>("POST", "/people", input).then((d) => unwrap<Person>(d, "person")),
    update: (id: number, input: PersonInput) =>
      request<unknown>("PATCH", `/people/${id}`, input).then((d) => unwrap<Person>(d, "person")),
    remove: (id: number) => request<unknown>("DELETE", `/people/${id}`),
  },
  seasons: {
    list: () => request<unknown>("GET", "/seasons").then((d) => unwrap<Season[]>(d, "seasons")),
    create: (input: SeasonInput & { name: string; kind: SeasonKind }) =>
      request<unknown>("POST", "/seasons", input).then((d) => unwrap<Season>(d, "season")),
    update: (id: number, input: SeasonInput) =>
      request<unknown>("PATCH", `/seasons/${id}`, input).then((d) => unwrap<Season>(d, "season")),
    budgets: (id: number) =>
      request<unknown>("GET", `/seasons/${id}/budgets`).then((d) => unwrap<PersonBudget[]>(d, "budgets")),
    setBudget: (id: number, personId: number, body: { budgetCents: number; stockingBudgetCents?: number }) =>
      request<unknown>("PUT", `/seasons/${id}/budgets/${personId}`, body),
    setFamilyBudget: (id: number, budgetCents: number) =>
      request<unknown>("PUT", `/seasons/${id}/family-budget`, { budgetCents }).then((d) => unwrap<Season>(d, "season")),
    draw: (id: number) => request<unknown>("GET", `/seasons/${id}/draw`).then(toDrawResult),
    runDraw: (id: number, body: { participantIds: number[]; avoidPreviousSeason: boolean }) =>
      request<unknown>("POST", `/seasons/${id}/draw`, body).then(toDrawResult),
    clearDraw: (id: number) => request<{ ok: true }>("DELETE", `/seasons/${id}/draw`),
  },
  gifts: {
    list: (filters: GiftFilters = {}) =>
      request<unknown>("GET", `/gifts${giftQueryString(filters)}`).then((d) => unwrap<Gift[]>(d, "gifts")),
    /** GET /gifts/:id (the contract's surprise rule refers to GET on a single gift). */
    get: (id: number) => request<unknown>("GET", `/gifts/${id}`).then((d) => unwrap<Gift>(d, "gift")),
    create: (input: GiftInput & { title: string; recipientIds: number[]; isFamily: boolean }) =>
      request<unknown>("POST", "/gifts", input).then((d) => unwrap<Gift>(d, "gift")),
    update: (id: number, input: GiftInput) =>
      request<unknown>("PATCH", `/gifts/${id}`, input).then((d) => unwrap<Gift>(d, "gift")),
    remove: (id: number) => request<unknown>("DELETE", `/gifts/${id}`),
    similar: (opts: { recipientIds: number[]; title: string; excludeId?: number; seasonId?: number | null }) =>
      request<unknown>("GET", `/gifts/similar${similarQueryString(opts)}`).then((d) => unwrap<SimilarGift[]>(d, "similar")),
    checkPrice: (id: number) => request<unknown>("POST", `/gifts/${id}/check-price`).then((d) => unwrap<Gift>(d, "gift")),
  },
  wishlist: {
    list: () => request<unknown>("GET", "/wishlist").then((d) => unwrap<WishItem[]>(d, "wishlist")),
    create: (input: WishInput & { title: string }) => request<WishItem>("POST", "/wishlist", input),
    update: (id: number, input: WishInput) => request<WishItem>("PATCH", `/wishlist/${id}`, input),
    /** Always a soft withdraw on the server. */
    remove: (id: number) => request<{ ok: true }>("DELETE", `/wishlist/${id}`),
  },
  users: () => request<unknown>("GET", "/users").then((d) => unwrap<UserSummary[]>(d, "users")),
  history: (personId: number) =>
    request<unknown>("GET", `/history?personId=${personId}`).then((d) => unwrap<HistorySeason[]>(d, "history")),
  stores: () => request<unknown>("GET", "/stores").then((d) => unwrap<string[]>(d, "stores")),
  dashboard: (seasonId?: number) =>
    request<Dashboard>("GET", `/dashboard${seasonId !== undefined ? `?seasonId=${seasonId}` : ""}`),
  activity: (opts: { limit?: number; seasonId?: number } = {}) =>
    request<unknown>("GET", `/activity${activityQueryString(opts)}`).then((d) => unwrap<ActivityEntry[]>(d, "activity")),
  linkPreview: (url: string) => request<LinkPreview>("POST", "/link-preview", { url }),
  importCsv: (body: ImportRequest) => request<ImportResult>("POST", "/import", body),
};
