import { and, desc, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { people, personBudgets, seasons } from "../../db/schema";
import { fail, idParam, notFound, parseJson } from "../http";
import { toSeason } from "../serialize";
import type { AppEnv } from "../types";
import { budgetPut, seasonCreate, seasonPatch } from "../validation";

export const seasonRoutes = new Hono<AppEnv>();

seasonRoutes.get("/", async (c) => {
  const rows = await c.var.db.select().from(seasons).orderBy(desc(seasons.date), desc(seasons.id)).all();
  return c.json(rows.map(toSeason));
});

seasonRoutes.post("/", async (c) => {
  const body = await parseJson(c, seasonCreate);
  const db = c.var.db;
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
