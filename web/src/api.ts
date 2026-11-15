// Typed client for the Phase 1 + Phase 2 API. See docs/API.md (the binding contract).
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
  recipientId: number;
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
}
export type GiftInput = Partial<Omit<Gift, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt">>;

export interface GiftFilters {
  /** A season id, or "none" for the ideas inbox. Omit for every season. */
  seasonId?: number | "none";
  recipientId?: number;
  status?: GiftStatus[];
  store?: string;
  category?: GiftCategory;
  giverId?: number;
  wished?: boolean;
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
  fairness: { personId: number; spentCents: number; committedCents: number; giftCount: number }[];
  attention: {
    returnsSoon: { giftId: number; title: string; recipientId: number; returnBy: string; level: "amber" | "red" }[];
    orderedNotReceived: { giftId: number; title: string; recipientId: number; store: string | null }[];
    receivedNotWrapped: { giftId: number; title: string; recipientId: number }[];
  };
}

// ---- Phase 2 ----

export type ActivityAction = "created" | "updated" | "deleted";

export interface ActivityEntry {
  id: number;
  userId: number;
  userName: string;
  action: ActivityAction;
  summary: string;
  giftId: number | null;
  recipientId: number | null;
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
    if (res.status === 401 && path !== "/auth/login") onUnauthorized?.();
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
  },
  gifts: {
    list: (filters: GiftFilters = {}) =>
      request<unknown>("GET", `/gifts${giftQueryString(filters)}`).then((d) => unwrap<Gift[]>(d, "gifts")),
    /** GET /gifts/:id (the contract's surprise rule refers to GET on a single gift). */
    get: (id: number) => request<unknown>("GET", `/gifts/${id}`).then((d) => unwrap<Gift>(d, "gift")),
    create: (input: GiftInput & { title: string; recipientId: number }) =>
      request<unknown>("POST", "/gifts", input).then((d) => unwrap<Gift>(d, "gift")),
    update: (id: number, input: GiftInput) =>
      request<unknown>("PATCH", `/gifts/${id}`, input).then((d) => unwrap<Gift>(d, "gift")),
    remove: (id: number) => request<unknown>("DELETE", `/gifts/${id}`),
  },
  stores: () => request<unknown>("GET", "/stores").then((d) => unwrap<string[]>(d, "stores")),
  dashboard: (seasonId?: number) =>
    request<Dashboard>("GET", `/dashboard${seasonId !== undefined ? `?seasonId=${seasonId}` : ""}`),
  activity: (opts: { limit?: number; seasonId?: number } = {}) =>
    request<unknown>("GET", `/activity${activityQueryString(opts)}`).then((d) => unwrap<ActivityEntry[]>(d, "activity")),
  linkPreview: (url: string) => request<LinkPreview>("POST", "/link-preview", { url }),
  importCsv: (body: ImportRequest) => request<ImportResult>("POST", "/import", body),
};
