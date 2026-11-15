import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { Hono } from "hono";
import { exchangeDraws, people, personBudgets, seasons, type SeasonKind } from "../../db/schema";
import { drawNames } from "../draw";
import { fail, idParam, notFound, parseJson } from "../http";
import { toSeason } from "../serialize";
import type { AppEnv, Variables } from "../types";
import { budgetPut, drawBody, familyBudgetPut, seasonCreate, seasonPatch } from "../validation";

type Db = Variables["db"];

export const seasonRoutes = new Hono<AppEnv>();

/** Season kinds that may have an honoree; for birthdays it's required. */
const HONOREE_KINDS: readonly SeasonKind[] = ["birthday", "anniversary", "other"];

/**
 * Validates the honoree for the season's resulting kind. `changed` = the honoree is being set
 * in this request (only then is the person itself re-checked).
 */
async function checkHonoree(db: Db, kind: SeasonKind, honoreeId: number | null, changed: boolean): Promise<void> {
  if (honoreeId == null) {
    if (kind === "birthday") fail(400, "honoreeId: a birthday season needs an honoree");
    return;
  }
  if (!HONOREE_KINDS.includes(kind)) fail(400, `honoreeId: ${kind} seasons don't have an honoree`);
  if (!changed) return;
  const p = await db
    .select({ id: people.id, giverOnly: people.giverOnly, archived: people.archived })
    .from(people)
    .where(eq(people.id, honoreeId))
    .get();
  if (!p) fail(400, "honoreeId: person not found");
  if (p.giverOnly) fail(400, "honoreeId: this person only gives gifts");
  if (p.archived) fail(400, "honoreeId: this person is archived");
}

seasonRoutes.get("/", async (c) => {
  const rows = await c.var.db.select().from(seasons).orderBy(desc(seasons.date), desc(seasons.id)).all();
  return c.json(rows.map(toSeason));
});

seasonRoutes.post("/", async (c) => {
  const body = await parseJson(c, seasonCreate);
  const db = c.var.db;
  await checkHonoree(db, body.kind, body.honoreeId, true);
  if (body.isActive) {
    // Deactivate the others first (a unique index allows only one active season).
    const [, inserted] = await db.batch([
      db.update(seasons).set({ isActive: false }).where(eq(seasons.isActive, true)),
      db.insert(seasons).values(body).returning(),
    ]);
    return c.json(toSeason(inserted[0]!), 201);
  }
  const row = await db.insert(seasons).values(body).returning().get();
  return c.json(toSeason(row), 201);
});

seasonRoutes.patch("/:id", async (c) => {
  const id = idParam(c);
  const body = await parseJson(c, seasonPatch);
  const db = c.var.db;
  const existing = await db.select().from(seasons).where(eq(seasons.id, id)).get();
  if (!existing) notFound("Season not found");
  if (Object.keys(body).length === 0) return c.json(toSeason(existing));
  const kind = body.kind ?? existing.kind;
  // Switching to Christmas drops a leftover honoree unless the request sets one explicitly.
  if (body.honoreeId === undefined && kind === "christmas" && existing.honoreeId != null) body.honoreeId = null;
  const honoreeChanged = body.honoreeId !== undefined && body.honoreeId !== existing.honoreeId;
  await checkHonoree(db, kind, body.honoreeId !== undefined ? body.honoreeId : existing.honoreeId, honoreeChanged);
  if (body.isActive) {
    const [, updated] = await db.batch([
      db.update(seasons).set({ isActive: false }).where(and(eq(seasons.isActive, true), ne(seasons.id, id))),
      db.update(seasons).set(body).where(eq(seasons.id, id)).returning(),
    ]);
    return c.json(toSeason(updated[0]!));
  }
  const row = await db.update(seasons).set(body).where(eq(seasons.id, id)).returning().get();
  return c.json(toSeason(row!));
});

seasonRoutes.get("/:id/budgets", async (c) => {
  const id = idParam(c);
  const db = c.var.db;
  const season = await db.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, id)).get();
  if (!season) notFound("Season not found");
  const rows = await db
    .select({
      personId: personBudgets.personId,
      budgetCents: personBudgets.budgetCents,
      stockingBudgetCents: personBudgets.stockingBudgetCents,
    })
    .from(personBudgets)
    .where(eq(personBudgets.seasonId, id))
    .all();
  return c.json(rows);
});

seasonRoutes.put("/:id/budgets/:personId", async (c) => {
  const seasonId = idParam(c);
  const personId = idParam(c, "personId");
  const body = await parseJson(c, budgetPut);
  const db = c.var.db;
  const [season, person] = await Promise.all([
    db.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, seasonId)).get(),
    db.select({ id: people.id, giverOnly: people.giverOnly }).from(people).where(eq(people.id, personId)).get(),
  ]);
  if (!season) notFound("Season not found");
  if (!person) notFound("Person not found");
  if (person.giverOnly) fail(400, "This person only gives gifts and can't have a budget");

  const set: { budgetCents: number; stockingBudgetCents?: number } = { budgetCents: body.budgetCents };
  if (body.stockingBudgetCents !== undefined) set.stockingBudgetCents = body.stockingBudgetCents;
  const row = await db
    .insert(personBudgets)
    .values({ seasonId, personId, budgetCents: body.budgetCents, stockingBudgetCents: body.stockingBudgetCents ?? 0 })
    .onConflictDoUpdate({ target: [personBudgets.seasonId, personBudgets.personId], set })
    .returning({
      personId: personBudgets.personId,
      budgetCents: personBudgets.budgetCents,
      stockingBudgetCents: personBudgets.stockingBudgetCents,
    })
    .get();
  return c.json(row);
});

/** PUT /seasons/:id/family-budget: the budget for family gifts; returns the updated Season. */
seasonRoutes.put("/:id/family-budget", async (c) => {
  const id = idParam(c);
  const { budgetCents } = await parseJson(c, familyBudgetPut);
  const row = await c.var.db.update(seasons).set({ familyBudgetCents: budgetCents }).where(eq(seasons.id, id)).returning().get();
  if (!row) notFound("Season not found");
  return c.json(toSeason(row));
});

// ---------------------------------------------------------------- kids' name draw

async function loadDraw(db: Db, seasonId: number) {
  return db
    .select({ giverId: exchangeDraws.giverId, recipientId: exchangeDraws.recipientId })
    .from(exchangeDraws)
    .where(eq(exchangeDraws.seasonId, seasonId))
    .orderBy(exchangeDraws.giverId)
    .all();
}

async function requireSeason(db: Db, id: number) {
  const season = await db.select().from(seasons).where(eq(seasons.id, id)).get();
  if (!season) notFound("Season not found");
  return season;
}

seasonRoutes.get("/:id/draw", async (c) => {
  const id = idParam(c);
  await requireSeason(c.var.db, id);
  return c.json(await loadDraw(c.var.db, id));
});

seasonRoutes.post("/:id/draw", async (c) => {
  const id = idParam(c);
  const db = c.var.db;
  const season = await requireSeason(db, id);
  const { participantIds, avoidPreviousSeason } = await parseJson(c, drawBody);

  const found = await db
    .select({ id: people.id, giverOnly: people.giverOnly, archived: people.archived })
    .from(people)
    .where(inArray(people.id, participantIds))
    .all();
  if (found.length !== participantIds.length) fail(400, "participantIds: person not found");
  if (found.some((p) => p.giverOnly)) fail(400, "participantIds: giver-only people can't take part");
  if (found.some((p) => p.archived)) fail(400, "participantIds: archived people can't take part");

  // The most recent earlier season of the same kind that has a draw.
  let previous: { giverId: number; recipientId: number }[] = [];
  if (avoidPreviousSeason) {
    const prev = await db
      .select({ id: seasons.id })
      .from(seasons)
      .innerJoin(exchangeDraws, eq(exchangeDraws.seasonId, seasons.id))
      .where(and(eq(seasons.kind, season.kind), ne(seasons.id, id), lt(seasons.date, season.date)))
      .orderBy(desc(seasons.date), desc(seasons.id))
      .limit(1)
      .get();
    if (prev) previous = await loadDraw(db, prev.id);
  }

  const result = drawNames(participantIds, previous);
  const now = new Date().toISOString();
  await db.batch([
    db.delete(exchangeDraws).where(eq(exchangeDraws.seasonId, id)),
    db.insert(exchangeDraws).values(result.pairs.map((p) => ({ seasonId: id, ...p, createdAt: now }))),
  ]);
  const pairs = [...result.pairs].sort((a, b) => a.giverId - b.giverId);
  return c.json(result.note ? { pairs, note: result.note } : { pairs });
});

seasonRoutes.delete("/:id/draw", async (c) => {
  const id = idParam(c);
  await requireSeason(c.var.db, id);
  await c.var.db.delete(exchangeDraws).where(eq(exchangeDraws.seasonId, id));
  return c.json({ ok: true });
});
