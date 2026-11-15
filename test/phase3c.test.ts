// Phase 3 part C: gifts for several people and family gifts.
import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/worker/csv";
import { addDays, todayUtc } from "../src/worker/rules";
import { call, makeUser } from "./helpers";

const today = todayUtc();

async function setup() {
  const mom = await makeUser("Mom");
  const dad = await makeUser("Dad");
  const person = async (name: string, kind = "kid") =>
    (await call("/people", { method: "POST", cookie: dad.cookie, body: { name: `${name}${mom.personId}`, kind } })).body;
  const ava = await person("Ava");
  const ben = await person("Ben");
  const cy = await person("Cy");
  const season = (
    await call("/seasons", { method: "POST", cookie: dad.cookie, body: { name: `Xmas ${mom.personId}`, date: addDays(today, 30), overallBudgetCents: 100000 } })
  ).body;
  const past = (await call("/seasons", { method: "POST", cookie: dad.cookie, body: { name: `Past ${mom.personId}`, date: addDays(today, -300) } })).body;
  const gift = async (who: { cookie: string }, body: Record<string, unknown>) => {
    const res = await call("/gifts", { method: "POST", cookie: who.cookie, body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  return { mom, dad, ava, ben, cy, season, past, gift, person };
}

describe("gift recipients: shape and validation", () => {
  it("stores several recipients (sorted) or a family gift", async () => {
    const { dad, ava, ben, cy, season, gift } = await setup();
    const shared = await gift(dad, { title: "Trampoline", recipientIds: [cy.id, ava.id, ben.id], seasonId: season.id });
    expect(shared).toMatchObject({ recipientIds: [ava.id, ben.id, cy.id], isFamily: false });
    expect(shared).not.toHaveProperty("recipientId");
    const family = await gift(dad, { title: "Board game", isFamily: true, seasonId: season.id });
    expect(family).toMatchObject({ recipientIds: [], isFamily: true });
    expect((await call(`/gifts/${shared.id}`, { cookie: dad.cookie })).body.recipientIds).toEqual([ava.id, ben.id, cy.id]);
    expect((await call(`/gifts/${family.id}`, { cookie: dad.cookie })).body).toMatchObject({ recipientIds: [], isFamily: true });
  });

  it("rejects invalid recipient combinations with 400", async () => {
    const { dad, ava, ben, season, person } = await setup();
    const santa = ((await call("/people", { cookie: dad.cookie })).body as any[]).find((p) => p.giverOnly);
    const gone = await person("Gone");
    await call(`/people/${gone.id}`, { method: "PATCH", cookie: dad.cookie, body: { archived: true } });
    const many = [];
    for (let i = 0; i < 11; i++) many.push((await person(`P${i}x`)).id);

    const bad: Record<string, unknown>[] = [
      { title: "None" }, // neither
      { title: "Empty", recipientIds: [] },
      { title: "Both", recipientIds: [ava.id], isFamily: true },
      { title: "Dupes", recipientIds: [ava.id, ava.id] },
      { title: "Too many", recipientIds: many },
      { title: "Giver only", recipientIds: [ava.id, santa.id] },
      { title: "Archived", recipientIds: [gone.id] },
      { title: "Unknown", recipientIds: [ava.id, 99999999] },
      { title: "Old field", recipientId: ava.id },
    ];
    for (const body of bad) {
      const r = await call("/gifts", { method: "POST", cookie: dad.cookie, body: { ...body, seasonId: season.id } });
      expect(r.status, String(body.title)).toBe(400);
      expect(r.body.error).toMatch(/recipient/i);
    }
    // Exactly 10 is fine.
    expect((await call("/gifts", { method: "POST", cookie: dad.cookie, body: { title: "Ten", recipientIds: many.slice(0, 10) } })).status).toBe(201);

    // PATCH: recipientIds replaces the list; isFamily alone clears people; people alone clear isFamily.
    const g = (await call("/gifts", { method: "POST", cookie: dad.cookie, body: { title: "Ball", recipientIds: [ava.id] } })).body;
    const p1 = await call(`/gifts/${g.id}`, { method: "PATCH", cookie: dad.cookie, body: { recipientIds: [ben.id, ava.id] } });
    expect(p1.body).toMatchObject({ recipientIds: [ava.id, ben.id], isFamily: false });
    const p2 = await call(`/gifts/${g.id}`, { method: "PATCH", cookie: dad.cookie, body: { isFamily: true } });
    expect(p2.body).toMatchObject({ recipientIds: [], isFamily: true });
    expect((await call(`/gifts/${g.id}`, { cookie: dad.cookie })).body).toMatchObject({ recipientIds: [], isFamily: true });
    expect((await call(`/gifts/${g.id}`, { method: "PATCH", cookie: dad.cookie, body: { isFamily: false } })).status).toBe(400);
    expect((await call(`/gifts/${g.id}`, { method: "PATCH", cookie: dad.cookie, body: { isFamily: true, recipientIds: [ava.id] } })).status).toBe(400);
    const p3 = await call(`/gifts/${g.id}`, { method: "PATCH", cookie: dad.cookie, body: { recipientIds: [ben.id] } });
    expect(p3.body).toMatchObject({ recipientIds: [ben.id], isFamily: false });
    expect((await call(`/gifts/${g.id}`, { method: "PATCH", cookie: dad.cookie, body: { recipientIds: [] } })).status).toBe(400);
    expect((await call(`/gifts/${g.id}`, { method: "PATCH", cookie: dad.cookie, body: { recipientIds: [santa.id] } })).status).toBe(400);
    expect((await call(`/gifts/${g.id}`, { cookie: dad.cookie })).body.recipientIds).toEqual([ben.id]);
  });
});

describe("money with shared and family gifts", () => {
  it("splits per person, counts totals once, and reports the family block", async () => {
    const { mom, dad, ava, ben, cy, season, gift } = await setup();
    // 1000 between three kids: 334 / 333 / 333 (the extra cent to the lowest id).
    await gift(dad, { title: "Trampoline", recipientIds: [cy.id, ben.id, ava.id], seasonId: season.id, status: "ordered", estPriceCents: 1000 });
    await gift(dad, { title: "Socks", recipientIds: [ben.id, cy.id], seasonId: season.id, status: "planned", category: "stocking", estPriceCents: 301 });
    await gift(dad, { title: "Bike", recipientIds: [ava.id], seasonId: season.id, status: "given", actualPriceCents: 5000 });
    await gift(dad, { title: "Idea", recipientIds: [ava.id, ben.id], seasonId: season.id, status: "idea", estPriceCents: 99999 });
    await gift(dad, { title: "Board game", isFamily: true, seasonId: season.id, status: "wrapped", estPriceCents: 2500 });
    await gift(dad, { title: "Movie night", isFamily: true, seasonId: season.id, status: "planned", estPriceCents: 1500 });

    const put = await call(`/seasons/${season.id}/family-budget`, { method: "PUT", cookie: dad.cookie, body: { budgetCents: 7000 } });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ id: season.id, familyBudgetCents: 7000 });
    expect((await call(`/seasons`, { cookie: dad.cookie })).body.find((s: any) => s.id === season.id).familyBudgetCents).toBe(7000);
    await call(`/seasons/${season.id}/budgets/${ava.id}`, { method: "PUT", cookie: dad.cookie, body: { budgetCents: 20000 } });
    await call(`/seasons/${season.id}/budgets/${ben.id}`, { method: "PUT", cookie: dad.cookie, body: { budgetCents: 10000 } });

    const d = (await call(`/dashboard?seasonId=${season.id}`, { cookie: mom.cookie })).body;
    const card = (id: number) => d.people.find((p: any) => p.personId === id);
    expect(card(ava.id)).toMatchObject({ spentCents: 334 + 5000, committedCents: 0, giftCount: 2, stockingCount: 0 });
    expect(card(ben.id)).toMatchObject({ spentCents: 333, committedCents: 151, giftCount: 2, stockingCount: 1, stockingCommittedCents: 151 });
    expect(card(cy.id)).toMatchObject({ spentCents: 333, committedCents: 150, giftCount: 2, stockingCount: 1, stockingCommittedCents: 150 });
    expect(card(ava.id).countsByStatus).toMatchObject({ ordered: 1, given: 1, idea: 1 });
    // The shares add back up to each price.
    const kids = [card(ava.id), card(ben.id), card(cy.id)];
    expect(kids.reduce((s, k) => s + k.spentCents, 0)).toBe(1000 + 5000);
    expect(kids.reduce((s, k) => s + k.committedCents, 0)).toBe(301);
    expect(d.fairness.filter((f: any) => [ava.id, ben.id, cy.id].includes(f.personId))).toEqual([
      { personId: ava.id, spentCents: 5334, committedCents: 0, giftCount: 2 },
      { personId: ben.id, spentCents: 333, committedCents: 151, giftCount: 2 },
      { personId: cy.id, spentCents: 333, committedCents: 150, giftCount: 2 },
    ]);
    // Totals: every gift once, at full price.
    expect(d.totals).toMatchObject({
      spentCents: 1000 + 5000 + 2500,
      committedCents: 301 + 1500,
      giftCount: 5,
      remainingCents: 100000 - 8500 - 1801,
      allocatedCents: 20000 + 10000 + 7000,
      unallocatedCents: 100000 - 37000,
    });
    expect(d.family).toEqual({ budgetCents: 7000, spentCents: 2500, committedCents: 1500, giftCount: 2 });
    expect(d.attention.receivedNotWrapped).toEqual([]);

    // Validation and 404 for the family budget.
    expect((await call(`/seasons/${season.id}/family-budget`, { method: "PUT", cookie: dad.cookie, body: { budgetCents: -1 } })).status).toBe(400);
    expect((await call(`/seasons/99999999/family-budget`, { method: "PUT", cookie: dad.cookie, body: { budgetCents: 1 } })).status).toBe(404);
  });
});

describe("surprise rule with several recipients", () => {
  it("hides a shared gift from a recipient, never hides family gifts, and hides activity both ways", async () => {
    const { mom, dad, ava, season, past, gift } = await setup();
    const shared = await gift(dad, { title: "Spa for two", recipientIds: [mom.personId, ava.id], seasonId: season.id, status: "ordered", estPriceCents: 900 });
    const family = await gift(dad, { title: "Board game", isFamily: true, seasonId: season.id, status: "ordered", estPriceCents: 600 });
    const inbox = await gift(dad, { title: "Inbox shared", recipientIds: [ava.id, mom.personId] });
    const oldShared = await gift(dad, { title: "Old shared", recipientIds: [mom.personId, ava.id], seasonId: past.id });

    const titles = async (who: { cookie: string }, q = "") =>
      ((await call(`/gifts${q}`, { cookie: who.cookie })).body as any[]).map((g) => g.title);
    expect(await titles(mom)).toEqual(expect.arrayContaining(["Board game", "Old shared"]));
    expect(await titles(mom)).not.toContain("Spa for two");
    expect(await titles(mom)).not.toContain("Inbox shared");
    expect(await titles(dad)).toEqual(expect.arrayContaining(["Spa for two", "Board game", "Inbox shared", "Old shared"]));
    expect((await call(`/gifts/${shared.id}`, { cookie: mom.cookie })).status).toBe(404);
    expect((await call(`/gifts/${inbox.id}`, { method: "PATCH", cookie: mom.cookie, body: { title: "x" } })).status).toBe(404);
    expect((await call(`/gifts/${family.id}`, { cookie: mom.cookie })).body).toMatchObject({ isFamily: true });
    expect((await call(`/gifts/${oldShared.id}`, { cookie: mom.cookie })).status).toBe(200);

    // Dashboard: Mom's view leaves the shared gift out entirely (Ava's card too); Dad's has it.
    const asMom = (await call(`/dashboard?seasonId=${season.id}`, { cookie: mom.cookie })).body;
    const asDad = (await call(`/dashboard?seasonId=${season.id}`, { cookie: dad.cookie })).body;
    expect(asMom.totals.spentCents).toBe(600);
    expect(asDad.totals.spentCents).toBe(1500);
    expect(asMom.people.find((p: any) => p.personId === ava.id).spentCents).toBe(0);
    expect(asDad.people.find((p: any) => p.personId === ava.id).spentCents).toBe(450);
    expect(asMom.people.find((p: any) => p.personId === mom.personId).hidden).toBe(true);
    expect(asMom.family).toMatchObject({ spentCents: 600, giftCount: 1 });
    expect(asMom.attention.orderedNotReceived).toEqual([{ giftId: family.id, title: "Board game", recipientIds: [], isFamily: true, store: "" }]);

    // Activity: logged recipients...
    const feedTitles = async (who: { cookie: string }) =>
      ((await call(`/activity?limit=100`, { cookie: who.cookie })).body as any[]).filter((a) => a.giftId != null).map((a) => a.summary);
    const momFeed = await feedTitles(mom);
    expect(momFeed).toContain(`Added "Board game" for the family`);
    expect(momFeed.some((s) => s.includes("Spa for two") || s.includes("Inbox shared"))).toBe(false);
    expect(await feedTitles(dad)).toContain(`Added "Spa for two" for ${mom.personName} & ${ava.name}`);
    const famRow = ((await call(`/activity?limit=100`, { cookie: dad.cookie })).body as any[]).find((a) => a.giftId === family.id);
    expect(famRow).toMatchObject({ recipientIds: [], recipientId: null });

    // ...and current recipients: adding Mom to a kid's gift hides its earlier rows from her;
    // taking Mom off a shared gift still hides the rows logged while she was on it.
    const kite = await gift(dad, { title: "Kite", recipientIds: [ava.id], seasonId: season.id });
    expect(await feedTitles(mom)).toContain(`Added "Kite" for ${ava.name}`);
    await call(`/gifts/${kite.id}`, { method: "PATCH", cookie: dad.cookie, body: { recipientIds: [ava.id, mom.personId] } });
    expect((await feedTitles(mom)).some((s) => s.includes("Kite"))).toBe(false);
    await call(`/gifts/${shared.id}`, { method: "PATCH", cookie: dad.cookie, body: { recipientIds: [ava.id] } });
    const after = await feedTitles(mom);
    expect(after).toContain(`Moved "Spa for two" to ${ava.name}`);
    expect(after).not.toContain(`Added "Spa for two" for ${mom.personName} & ${ava.name}`);
    // Now visible to Mom as a gift.
    expect((await call(`/gifts/${shared.id}`, { cookie: mom.cookie })).status).toBe(200);

    // Family conversions and deletes are worded for the family.
    await call(`/gifts/${kite.id}`, { method: "PATCH", cookie: dad.cookie, body: { isFamily: true } });
    await call(`/gifts/${kite.id}`, { method: "DELETE", cookie: dad.cookie });
    const dadFeed = await feedTitles(dad);
    expect(dadFeed).toContain(`Moved "Kite" to the family`);
    expect(dadFeed).toContain(`Deleted "Kite" for the family`);
  });
});

describe("endpoints that filter by recipient", () => {
  it("/gifts?recipientId matches any recipient; recipientId=family returns family gifts", async () => {
    const { dad, ava, ben, cy, season, gift } = await setup();
    const a = await gift(dad, { title: "Only Ava", recipientIds: [ava.id], seasonId: season.id });
    const ab = await gift(dad, { title: "Ava and Ben", recipientIds: [ava.id, ben.id], seasonId: season.id });
    const f = await gift(dad, { title: "Family thing", isFamily: true, seasonId: season.id });
    await gift(dad, { title: "Only Cy", recipientIds: [cy.id], seasonId: season.id });
    const ids = async (q: string) => ((await call(`/gifts?seasonId=${season.id}&${q}`, { cookie: dad.cookie })).body as any[]).map((g) => g.id).sort();
    expect(await ids(`recipientId=${ava.id}`)).toEqual([a.id, ab.id].sort());
    expect(await ids(`recipientId=${ben.id}`)).toEqual([ab.id]);
    expect(await ids(`recipientId=family`)).toEqual([f.id]);
    expect((await call(`/gifts?recipientId=bogus`, { cookie: dad.cookie })).status).toBe(400);
  });

  it("history and similar include shared gifts", async () => {
    const { mom, dad, ava, ben, cy, season, past, gift } = await setup();
    const shared = await gift(dad, { title: "LEGO Castle", recipientIds: [ava.id, ben.id], seasonId: past.id, status: "given" });
    const fam = await gift(dad, { title: "Family LEGO Castle", isFamily: true, seasonId: past.id, status: "given" });
    const hist = (await call(`/history?personId=${ben.id}`, { cookie: mom.cookie })).body;
    expect(hist.map((h: any) => h.season.id)).toEqual([past.id]);
    expect(hist[0].gifts.map((g: any) => g.id)).toEqual([shared.id]);

    const similar = async (q: string) =>
      ((await call(`/gifts/similar?${q}&title=lego%20castle&seasonId=${season.id}`, { cookie: dad.cookie })).body as any[]).map((m) => m.giftId);
    expect(await similar(`recipientIds=${ben.id},${cy.id}`)).toEqual([shared.id]);
    expect(await similar(`recipientIds=${cy.id}`)).toEqual([]);
    expect(await similar(`recipientIds=family`)).toEqual([fam.id]);
    expect(await similar(`recipientId=${ava.id}`)).toEqual([shared.id]); // the old single form still works
    expect((await call(`/gifts/similar?recipientIds=1,x&title=lego`, { cookie: dad.cookie })).status).toBe(400);
    expect((await call(`/gifts/similar?title=lego`, { cookie: dad.cookie })).status).toBe(400);
  });

  it("people: shared recipients count as receiving gifts", async () => {
    const { dad, ava, ben, gift } = await setup();
    await gift(dad, { title: "Shared", recipientIds: [ava.id, ben.id] });
    expect((await call(`/people/${ben.id}`, { method: "PATCH", cookie: dad.cookie, body: { giverOnly: true } })).status).toBe(409);
    expect((await call(`/people/${ben.id}`, { method: "DELETE", cookie: dad.cookie })).body).toEqual({ ok: true, archived: true });
    // Family gifts don't tie anyone down.
    const solo = (await call("/people", { method: "POST", cookie: dad.cookie, body: { name: "Solo", kind: "other" } })).body;
    await gift(dad, { title: "Fam", isFamily: true });
    expect((await call(`/people/${solo.id}`, { method: "PATCH", cookie: dad.cookie, body: { giverOnly: true } })).status).toBe(200);
  });
});

describe("CSV with shared and family gifts", () => {
  it("exports names joined with & (or Family) and imports them back", async () => {
    const { mom, dad, ava, ben, season, gift } = await setup();
    await gift(dad, { title: "Trampoline", recipientIds: [ben.id, ava.id], seasonId: season.id, estPriceCents: 15000 });
    await gift(dad, { title: "Board game", isFamily: true, seasonId: season.id, giverIds: [dad.personId] });
    await gift(dad, { title: "Book", recipientIds: [ava.id], seasonId: season.id });

    const exported = (await call(`/export.csv?seasonId=${season.id}`, { cookie: mom.cookie })).text;
    const rows = parseCsv(exported.replace(/^﻿/, "")).map((r) => r.fields);
    const recipientCol = rows[0]!.indexOf("recipient");
    const byTitle = new Map(rows.slice(1).map((r) => [r[2], r[recipientCol]]));
    expect(byTitle.get("Trampoline")).toBe(`${ava.name} & ${ben.name}`);
    expect(byTitle.get("Board game")).toBe("Family");
    expect(byTitle.get("Book")).toBe(ava.name);
    expect(rows[rows.length - 1]![2]).toBe("Board game"); // family gifts sort after people's

    const target = (await call("/seasons", { method: "POST", cookie: dad.cookie, body: { name: `Import ${mom.personId}`, date: addDays(today, 40) } })).body;
    const imp = await call("/import", { method: "POST", cookie: dad.cookie, body: { csv: exported, seasonId: target.id, dryRun: false } });
    expect(imp.status).toBe(200);
    expect(imp.body.created).toBe(3);
    expect(imp.body.rows.find((r: any) => r.title === "Board game")).toMatchObject({ ok: true, recipient: "Family" });
    const list = (await call(`/gifts?seasonId=${target.id}`, { cookie: dad.cookie })).body as any[];
    const t = (title: string) => list.find((g) => g.title === title);
    expect(t("Trampoline")).toMatchObject({ recipientIds: [ava.id, ben.id], isFamily: false, estPriceCents: 15000 });
    expect(t("Board game")).toMatchObject({ recipientIds: [], isFamily: true, giverIds: [dad.personId] });
    expect(t("Book")).toMatchObject({ recipientIds: [ava.id], isFamily: false });

    // Case-insensitive names and "family"; errors per row.
    const csv = [
      "title,recipient",
      `A,${ava.name.toUpperCase()} & ${ben.name.toLowerCase()}`,
      "B,FAMILY",
      `C,${ava.name} & Nobody`,
      `D,${ava.name} & ${ava.name}`,
      `E,${ava.name} & Santa`,
    ].join("\n");
    const dry = await call("/import", { method: "POST", cookie: dad.cookie, body: { csv, seasonId: null, dryRun: true } });
    expect(dry.body.rows).toEqual([
      { line: 2, ok: true, title: "A", recipient: `${ava.name} & ${ben.name}` },
      { line: 3, ok: true, title: "B", recipient: "Family" },
      { line: 4, ok: false, title: "C", recipient: `${ava.name} & Nobody`, error: 'Unknown person "Nobody"' },
      { line: 5, ok: false, title: "D", recipient: `${ava.name} & ${ava.name}`, error: `${ava.name} is listed twice` },
      { line: 6, ok: false, title: "E", recipient: `${ava.name} & Santa`, error: "Santa only gives gifts" },
    ]);
  });
});
