import { asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { giftGivers, gifts, people, users } from "../../db/schema";
import { fail, idParam, notFound, parseJson } from "../http";
import { toPerson } from "../serialize";
import type { AppEnv } from "../types";
import { personCreate, personPatch } from "../validation";

export const peopleRoutes = new Hono<AppEnv>();

peopleRoutes.get("/", async (c) => {
  const includeArchived = c.req.query("includeArchived") === "1";
  const rows = await c.var.db
    .select()
    .from(people)
    .where(includeArchived ? undefined : eq(people.archived, false))
    .orderBy(asc(people.sortOrder), sql`${people.name} COLLATE NOCASE`, asc(people.id))
    .all();
  return c.json(rows.map(toPerson));
});

peopleRoutes.post("/", async (c) => {
  const body = await parseJson(c, personCreate);
  const row = await c.var.db.insert(people).values(body).returning().get();
  return c.json(toPerson(row), 201);
});

peopleRoutes.patch("/:id", async (c) => {
  const id = idParam(c);
  const body = await parseJson(c, personPatch);
  const db = c.var.db;
  const row =
    Object.keys(body).length > 0
      ? await db.update(people).set(body).where(eq(people.id, id)).returning().get()
      : await db.select().from(people).where(eq(people.id, id)).get();
  if (!row) notFound("Person not found");
  return c.json(toPerson(row));
});

peopleRoutes.delete("/:id", async (c) => {
  const id = idParam(c);
  const db = c.var.db;
  const person = await db.select().from(people).where(eq(people.id, id)).get();
  if (!person) notFound("Person not found");

  const linked = await db.select({ id: users.id }).from(users).where(eq(users.personId, id)).get();
  if (linked) fail(409, "This person is linked to a login and can't be deleted");

  // "Has gifts" = is the recipient of any gift or a giver on any gift.
  const [asRecipient, asGiver] = await Promise.all([
    db.select({ id: gifts.id }).from(gifts).where(eq(gifts.recipientId, id)).limit(1).get(),
    db.select({ id: giftGivers.giftId }).from(giftGivers).where(eq(giftGivers.personId, id)).limit(1).get(),
  ]);
  const hasGifts = Boolean(asRecipient || asGiver);

  if (hasGifts) {
    await db.update(people).set({ archived: true }).where(eq(people.id, id));
    return c.json({ ok: true, archived: true });
  }
  await db.delete(people).where(eq(people.id, id));
  return c.json({ ok: true, archived: false });
});
