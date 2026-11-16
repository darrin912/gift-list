// GET /export.csv and POST /import.
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  activityLog,
  GIFT_CATEGORIES,
  GIFT_STATUSES,
  giftGivers,
  giftRecipients,
  gifts,
  people,
  seasons,
  type GiftCategory,
  type GiftStatus,
  type PersonRow,
  type SeasonRow,
} from "../../db/schema";
import { importedSummary } from "../activity";
import { CsvError, parseCsv, safeTextCell, toCsv, unescapeTextCell } from "../csv";
import { wishSnapshotOf } from "../rules";
import { loadGiverIds, loadVisibleGifts, type GiftWithSeason } from "../gift-access";
import { fail, notFound, parseJson, parseQuery, zodMessage } from "../http";
import { formatCents, parsePriceToCents } from "../price";
import type { AppEnv } from "../types";
import { exportQuery, giftCreate, importBody, MAX_RECIPIENTS } from "../validation";

export const CSV_COLUMNS = [
  "season",
  "recipient",
  "title",
  "status",
  "category",
  "wished",
  "priority",
  "est_price",
  "actual_price",
  "store",
  "url",
  "order_number",
  "tracking_url",
  "return_by",
  "from",
  "description",
] as const;
type Column = (typeof CSV_COLUMNS)[number];

export const IMPORT_MAX_ROWS = 1000;

// ---------------------------------------------------------------- export

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** The CSV `recipient` cell value for a family gift (matched case-insensitively on import). */
export const FAMILY_CELL = "Family";

export function exportRows(rows: GiftWithSeason[], peopleById: Map<number, PersonRow>, givers: Map<number, number[]>): string[][] {
  const name = (id: number) => peopleById.get(id)?.name ?? "";
  const byPersonOrder = (x: number, y: number) =>
    (peopleById.get(x)?.sortOrder ?? 0) - (peopleById.get(y)?.sortOrder ?? 0) || name(x).localeCompare(name(y)) || x - y;
  const recipientsOf = (g: GiftWithSeason["gift"]) => (g.isFamily ? [] : [...g.recipientIds].sort(byPersonOrder));
  const recipientCell = (g: GiftWithSeason["gift"]) =>
    g.isFamily ? FAMILY_CELL : recipientsOf(g).map(name).filter(Boolean).join(" & ");
  const sorted = [...rows].sort((a, b) => {
    const da = a.season?.date ?? "";
    const dbb = b.season?.date ?? "";
    if (da !== dbb) return da < dbb ? 1 : -1; // newest season first, ideas inbox last
    // Family gifts after everyone's; otherwise by the first recipient in people order.
    if (a.gift.isFamily !== b.gift.isFamily) return a.gift.isFamily ? 1 : -1;
    const pa = recipientsOf(a.gift)[0];
    const pb = recipientsOf(b.gift)[0];
    return (
      (pa !== undefined && pb !== undefined ? byPersonOrder(pa, pb) : 0) ||
      recipientCell(a.gift).localeCompare(recipientCell(b.gift)) ||
      a.gift.title.localeCompare(b.gift.title) ||
      a.gift.id - b.gift.id
    );
  });
  const out: string[][] = [[...CSV_COLUMNS]];
  for (const { gift: g, season } of sorted) {
    const from = (givers.get(g.id) ?? [])
      .map(name)
      .filter(Boolean)
      .sort((x, y) => x.localeCompare(y))
      .join(" & ");
    const cells: Record<Column, string> = {
      season: safeTextCell(season?.name ?? ""),
      recipient: safeTextCell(recipientCell(g)),
      title: safeTextCell(g.title),
      status: g.status,
      category: g.category,
      wished: g.wished ? "yes" : "no",
      priority: String(g.priority),
      // Prices are formatted by us and never negative: no formula escaping needed.
      est_price: formatCents(g.estPriceCents),
      actual_price: formatCents(g.actualPriceCents),
      store: safeTextCell(g.store),
      url: safeTextCell(g.url),
      order_number: safeTextCell(g.orderNumber),
      tracking_url: safeTextCell(g.trackingUrl),
      return_by: g.returnBy ?? "",
      from: safeTextCell(from),
      description: safeTextCell(g.description),
    };
    out.push(CSV_COLUMNS.map((c) => cells[c]));
  }
  return out;
}

// ---------------------------------------------------------------- import

export interface ImportRowResult {
  line: number;
  ok: boolean;
  error?: string;
  title?: string;
  recipient?: string;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

const TRUTHY = new Set(["yes", "y", "true", "1", "x", "✓", "✔"]);

/** YYYY-MM-DD, or M/D/YYYY and M/D/YY (US spreadsheet format). "" -> null; undefined = invalid. */
export function parseDateCell(s: string): string | null | undefined {
  const v = s.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(v);
  if (m) {
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${year}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  }
  return undefined;
}

type PeopleIndex = Map<string, PersonRow[]>;

function indexPeople(all: PersonRow[]): PeopleIndex {
  const idx: PeopleIndex = new Map();
  for (const p of all) {
    const k = p.name.trim().toLowerCase();
    idx.set(k, [...(idx.get(k) ?? []), p]);
  }
  return idx;
}

function resolvePerson(idx: PeopleIndex, raw: string): { person: PersonRow } | { error: string } {
  const matches = idx.get(raw.trim().toLowerCase()) ?? [];
  const active = matches.filter((p) => !p.archived);
  const pool = active.length ? active : matches;
  if (pool.length === 0) return { error: `Unknown person "${raw.trim()}"` };
  if (pool.length > 1) return { error: `More than one person is named "${raw.trim()}"` };
  return { person: pool[0]! };
}

/**
 * The `recipient` cell: "Family" (any case), one name, or names joined with "&". A name that
 * itself contains "&" still matches when it's the whole cell.
 */
function resolveRecipients(
  idx: PeopleIndex,
  raw: string,
): { isFamily: boolean; people: PersonRow[] } | { error: string } {
  if (raw.trim().toLowerCase() === FAMILY_CELL.toLowerCase()) return { isFamily: true, people: [] };
  const whole = idx.get(raw.trim().toLowerCase());
  const names = whole?.length ? [raw] : raw.split(/\s*&\s*/).filter((s) => s.trim());
  const found: PersonRow[] = [];
  for (const n of names) {
    const r = resolvePerson(idx, n);
    if ("error" in r) return r;
    if (r.person.giverOnly) return { error: `${r.person.name} only gives gifts` };
    if (r.person.archived) return { error: `${r.person.name} is archived` };
    if (found.some((p) => p.id === r.person.id)) return { error: `${r.person.name} is listed twice` };
    found.push(r.person);
  }
  if (found.length > MAX_RECIPIENTS) return { error: `At most ${MAX_RECIPIENTS} recipients` };
  return { isFamily: false, people: found };
}

interface ParsedImportRow {
  result: ImportRowResult;
  gift?: ReturnType<typeof giftCreate.parse>;
}

export function buildImportRows(
  csvText: string,
  allPeople: PersonRow[],
  seasonId: number | null,
): { rows: ParsedImportRow[] } | { error: string } {
  let records;
  try {
    records = parseCsv(csvText);
  } catch (e) {
    if (e instanceof CsvError) return { error: e.message };
    throw e;
  }
  const isBlank = (fields: string[]) => fields.every((f) => f.trim() === "");
  const nonBlank = records.filter((r) => !isBlank(r.fields));
  const header = nonBlank.shift();
  if (!header) return { error: "The CSV is empty" };
  const colIndex = new Map<string, number>();
  header.fields.forEach((h, i) => {
    const k = normalizeHeader(h);
    if (k && !colIndex.has(k)) colIndex.set(k, i);
  });
  if (!colIndex.has("title") || !colIndex.has("recipient")) {
    return { error: "The CSV needs a header row with title and recipient columns" };
  }
  if (nonBlank.length > IMPORT_MAX_ROWS) return { error: `Too many rows (max ${IMPORT_MAX_ROWS})` };

  const idx = indexPeople(allPeople);
  const rows: ParsedImportRow[] = nonBlank.map(({ line, fields }) => {
    const get = (col: Column) => {
      const i = colIndex.get(col);
      return i === undefined ? "" : unescapeTextCell((fields[i] ?? "").trim());
    };
    const title = get("title");
    const recipientName = get("recipient");
    const result: ImportRowResult = { line, ok: false };
    if (title) result.title = title;
    if (recipientName) result.recipient = recipientName;
    const err = (error: string): ParsedImportRow => ({ result: { ...result, error } });

    if (!title) return err("title is required");
    if (!recipientName) return err("recipient is required");
    const r = resolveRecipients(idx, recipientName);
    if ("error" in r) return err(r.error);
    result.recipient = r.isFamily ? FAMILY_CELL : r.people.map((p) => p.name).join(" & ");

    const giverIds: number[] = [];
    for (const n of get("from").split(/\s*&\s*/).filter((s) => s.trim())) {
      const g = resolvePerson(idx, n);
      if ("error" in g) return err(`from: ${g.error}`);
      giverIds.push(g.person.id);
    }

    const prices: Partial<Record<"estPriceCents" | "actualPriceCents", number | null>> = {};
    for (const [col, key] of [["est_price", "estPriceCents"], ["actual_price", "actualPriceCents"]] as const) {
      const raw = get(col);
      const cents = raw ? parsePriceToCents(raw) : null;
      if (raw && cents == null) return err(`${col}: "${raw}" isn't a price`);
      prices[key] = cents;
    }
    const returnBy = parseDateCell(get("return_by"));
    if (returnBy === undefined) return err(`return_by: "${get("return_by")}" isn't a date (use YYYY-MM-DD)`);

    const statusRaw = get("status").toLowerCase();
    const categoryRaw = get("category").toLowerCase();
    const priority = Number(get("priority"));
    const parsed = giftCreate.safeParse({
      seasonId,
      recipientIds: r.people.map((p) => p.id),
      isFamily: r.isFamily,
      title,
      description: get("description"),
      url: get("url"),
      category: !categoryRaw ? "main" : (GIFT_CATEGORIES as readonly string[]).includes(categoryRaw) ? (categoryRaw as GiftCategory) : "other",
      status: (GIFT_STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as GiftStatus) : "idea",
      wished: TRUTHY.has(get("wished").toLowerCase()),
      priority: priority === 1 || priority === 3 ? priority : 2,
      ...prices,
      store: get("store"),
      orderNumber: get("order_number"),
      trackingUrl: get("tracking_url"),
      returnBy,
      giverIds,
    });
    if (!parsed.success) return err(zodMessage(parsed.error));
    return { result: { ...result, ok: true }, gift: parsed.data };
  });
  return { rows };
}

// ---------------------------------------------------------------- routes

export const csvRoutes = new Hono<AppEnv>();

csvRoutes.get("/export.csv", async (c) => {
  const { seasonId } = parseQuery(c, exportQuery);
  const db = c.var.db;
  let season: SeasonRow | undefined;
  if (seasonId !== undefined) {
    season = await db.select().from(seasons).where(eq(seasons.id, seasonId)).get();
    if (!season) notFound("Season not found");
  }
  const [rows, allPeople] = await Promise.all([
    loadVisibleGifts(db, c.var.user, c.var.today, season ? eq(gifts.seasonId, season.id) : undefined),
    db.select().from(people).all(),
  ]);
  const givers = await loadGiverIds(
    db,
    rows.map((r) => r.gift.id),
  );
  const csv = toCsv(exportRows(rows, new Map(allPeople.map((p) => [p.id, p])), givers), { bom: true });
  const slug = season ? slugify(season.name) || `season-${season.id}` : "all";
  return c.body(csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="gifts-${slug}.csv"`,
  });
});

csvRoutes.post("/import", async (c) => {
  const body = await parseJson(c, importBody);
  const db = c.var.db;
  const user = c.var.user;
  if (body.seasonId != null) {
    const s = await db.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, body.seasonId)).get();
    if (!s) fail(400, "seasonId: season not found");
  }
  const built = buildImportRows(body.csv, await db.select().from(people).all(), body.seasonId);
  if ("error" in built) fail(400, built.error);

  const valid = built.rows.filter((r) => r.gift);
  if (!body.dryRun && valid.length > 0) {
    const now = new Date().toISOString();
    // One atomic batch. Recipients and givers reference the gift inserted just before them via max(id),
    // which is safe because D1 runs a batch as a single transaction.
    const stmts = valid.flatMap(({ gift }) => {
      const { giverIds, recipientIds, ...values } = gift!;
      return [
        db.insert(gifts).values({
          ...values,
          // Importing a wished gift for yourself alone makes it one of your wishlist items.
          wishSnapshot:
            values.wished && !values.isFamily && recipientIds.length === 1 && recipientIds[0] === user.personId
              ? wishSnapshotOf(values, now)
              : null,
          createdBy: user.id,
          updatedBy: user.id,
          createdAt: now,
          updatedAt: now,
        }),
        ...(recipientIds.length
          ? [db.insert(giftRecipients).values(recipientIds.map((personId) => ({ giftId: sql`(SELECT max(id) FROM gifts)`, personId })))]
          : []),
        ...(giverIds.length
          ? [db.insert(giftGivers).values(giverIds.map((personId) => ({ giftId: sql`(SELECT max(id) FROM gifts)`, personId })))]
          : []),
      ];
    });
    await db.batch([
      db.insert(activityLog).values({
        userId: user.id,
        giftId: null,
        recipientId: null,
        recipientIds: null,
        seasonId: body.seasonId,
        action: "create",
        summary: importedSummary(valid.length),
        at: now,
      }),
      ...stmts,
    ]);
  }
  return c.json({ created: body.dryRun ? 0 : valid.length, rows: built.rows.map((r) => r.result) });
});
