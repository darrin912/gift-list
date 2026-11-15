import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCsv } from "../src/worker/csv";
import { addDays, todayUtc } from "../src/worker/rules";
import { call, makeUser } from "./helpers";

const today = todayUtc();

async function setup() {
  const mom = await makeUser("Mom");
  const dad = await makeUser("Dad");
  const kid = (await call("/people", { method: "POST", cookie: dad.cookie, body: { name: `Ava${mom.personId}`, kind: "kid" } })).body;
  const season = (await call("/seasons", { method: "POST", cookie: dad.cookie, body: { name: `Xmas ${mom.personId}`, date: addDays(today, 30), overallBudgetCents: 100000 } })).body;
  const past = (await call("/seasons", { method: "POST", cookie: dad.cookie, body: { name: `Past ${mom.personId}`, date: addDays(today, -10) } })).body;
  const gift = (who: { cookie: string }, body: Record<string, unknown>) => call("/gifts", { method: "POST", cookie: who.cookie, body });
  return { mom, dad, kid, season, past, gift };
}

describe("activity feed", () => {
  it("writes readable summaries and hides rows about the viewer's surprises", async () => {
    const { mom, dad, kid, season, past, gift } = await setup();
    const socks = (await gift(dad, { title: "Fuzzy socks", recipientIds: [kid.id], seasonId: season.id })).body;
    await call(`/gifts/${socks.id}`, { method: "PATCH", cookie: dad.cookie, body: { status: "wrapped" } });
    await call(`/gifts/${socks.id}`, { method: "PATCH", cookie: dad.cookie, body: { store: "Target", estPriceCents: 500 } });
    await call(`/gifts/${socks.id}`, { method: "PATCH", cookie: dad.cookie, body: { store: "Target" } }); // no-op: no row
    const necklace = (await gift(dad, { title: "Necklace", recipientIds: [mom.personId], seasonId: season.id })).body;
    await call(`/gifts/${necklace.id}`, { method: "PATCH", cookie: dad.cookie, body: { status: "ordered" } });
    const spa = (await gift(dad, { title: "Spa day", recipientIds: [mom.personId] })).body; // ideas inbox: hidden
    const scarf = (await gift(dad, { title: "Old scarf", recipientIds: [mom.personId], seasonId: past.id })).body; // past: visible
    // A gift first logged for the kid, then moved to Mom: its whole history is hidden from her now.
    const moved = (await gift(dad, { title: "Perfume", recipientIds: [kid.id], seasonId: season.id })).body;
    await call(`/gifts/${moved.id}`, { method: "PATCH", cookie: dad.cookie, body: { recipientIds: [mom.personId] } });
    await call(`/gifts/${socks.id}`, { method: "DELETE", cookie: dad.cookie });

    const asDad = (await call(`/activity?seasonId=${season.id}`, { cookie: dad.cookie })).body as any[];
    expect(asDad.map((a) => a.summary)).toEqual([
      `Deleted "Fuzzy socks" for ${kid.name}`,
      `Moved "Perfume" to ${mom.personName}`,
      `Added "Perfume" for ${kid.name}`,
      `Marked "Necklace" as ordered`,
      `Added "Necklace" for ${mom.personName}`,
      `Updated price, store on "Fuzzy socks" for ${kid.name}`,
      `Marked "Fuzzy socks" as wrapped`,
      `Added "Fuzzy socks" for ${kid.name}`,
    ]);
    expect(asDad[0]).toEqual({
      id: expect.any(Number),
      userId: dad.userId,
      userName: "Dad",
      action: "deleted",
      summary: `Deleted "Fuzzy socks" for ${kid.name}`,
      giftId: socks.id,
      recipientId: kid.id,
      recipientIds: [kid.id],
      seasonId: season.id,
      at: expect.any(String),
    });
    expect(asDad.map((a) => a.action)).toContain("created");
    expect(asDad.map((a) => a.action)).toContain("updated");

    const asMom = (await call(`/activity?limit=100`, { cookie: mom.cookie })).body as any[];
    const momGiftIds = new Set(asMom.map((a) => a.giftId));
    expect(momGiftIds.has(necklace.id)).toBe(false);
    expect(momGiftIds.has(spa.id)).toBe(false);
    expect(momGiftIds.has(moved.id)).toBe(false);
    expect(momGiftIds.has(scarf.id)).toBe(true);
    expect(momGiftIds.has(socks.id)).toBe(true);
    expect(asMom.some((a) => /Necklace|Spa day|Perfume/.test(a.summary))).toBe(false);

    // Limit + newest first.
    const two = (await call(`/activity?limit=2&seasonId=${season.id}`, { cookie: mom.cookie })).body as any[];
    expect(two).toHaveLength(2);
    expect(two[0].id).toBeGreaterThan(two[1].id);
    expect((await call(`/activity?limit=0`, { cookie: mom.cookie })).status).toBe(400);
    expect((await call(`/activity?limit=101`, { cookie: mom.cookie })).status).toBe(400);
    expect((await call(`/activity`)).status).toBe(401);

    // Archiving the season reveals Mom's history.
    await call(`/seasons/${season.id}`, { method: "PATCH", cookie: dad.cookie, body: { archived: true } });
    const after = (await call(`/activity?seasonId=${season.id}`, { cookie: mom.cookie })).body as any[];
    expect(after.some((a) => a.giftId === necklace.id)).toBe(true);
  });

  it("fills the limit even when many recent rows are hidden", async () => {
    const { mom, dad, kid, season, gift } = await setup();
    await gift(dad, { title: "Visible", recipientIds: [kid.id], seasonId: season.id });
    for (let i = 0; i < 60; i++) await gift(dad, { title: `Secret ${i}`, recipientIds: [mom.personId], seasonId: season.id });
    const feed = (await call(`/activity?limit=1&seasonId=${season.id}`, { cookie: mom.cookie })).body as any[];
    expect(feed.map((a) => a.summary)).toEqual([`Added "Visible" for ${kid.name}`]);
  });
});

describe("link preview", () => {
  afterEach(() => vi.restoreAllMocks());

  it("validates the URL, fetches with a mocked fetch, and rate-limits per user", async () => {
    const u = await makeUser("Preview");
    for (const url of ["ftp://x.com", "http://localhost:8787/", "http://192.168.0.1/", "http://example.com:8443/", "nope"]) {
      const r = await call("/link-preview", { method: "POST", cookie: u.cookie, body: { url } });
      expect(r.status, url).toBe(400);
      expect(r.body.error).toBeTypeOf("string");
    }
    expect((await call("/link-preview", { method: "POST", cookie: u.cookie, body: {} })).status).toBe(400);

    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        `<html><head><title>Tree House | LEGO</title><meta property="og:image" content="/th.jpg">
         <script type="application/ld+json">{"@type":"Product","offers":{"price":"129.99"}}</script></head></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      ),
    );
    const ok = await call("/link-preview", { method: "POST", cookie: u.cookie, body: { url: "https://www.lego.com/en-us/product/tree-house" } });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ title: "Tree House | LEGO", imageUrl: "https://www.lego.com/th.jpg", priceCents: 12999, store: "Lego" });
    const init = spy.mock.calls[0]![1]!;
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).get("User-Agent")).toMatch(/Mozilla/);

    spy.mockImplementation(async () => new Response("denied", { status: 403 }));
    const blocked = await call("/link-preview", { method: "POST", cookie: u.cookie, body: { url: "https://www.target.com/p/1" } });
    expect(blocked.status).toBe(200);
    expect(blocked.body).toEqual({ title: "", imageUrl: "", priceCents: null, store: "Target", blocked: true });

    // 2 used so far; 28 more are allowed, then 429.
    for (let i = 0; i < 28; i++) {
      expect((await call("/link-preview", { method: "POST", cookie: u.cookie, body: { url: "https://www.target.com/p/1" } })).status).toBe(200);
    }
    const limited = await call("/link-preview", { method: "POST", cookie: u.cookie, body: { url: "https://www.target.com/p/1" } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    // Another user isn't affected.
    const other = await makeUser("Other");
    expect((await call("/link-preview", { method: "POST", cookie: other.cookie, body: { url: "https://www.target.com/p/1" } })).status).toBe(200);
  });
});

describe("CSV export and import", () => {
  it("exports visible gifts with formula escaping and hides the viewer's surprises", async () => {
    const { mom, dad, kid, season, gift } = await setup();
    await gift(dad, {
      title: "=HYPERLINK(\"http://evil\")",
      recipientIds: [kid.id],
      seasonId: season.id,
      status: "ordered",
      estPriceCents: 123456,
      actualPriceCents: 99,
      store: "Shop, Inc.",
      description: "line 1\nline \"2\"",
      giverIds: [dad.personId, mom.personId],
      wished: true,
      returnBy: "2030-01-02",
    });
    await gift(dad, { title: "Secret ring", recipientIds: [mom.personId], seasonId: season.id });

    const res = await call(`/export.csv?seasonId=${season.id}`, { cookie: mom.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/csv/);
    expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="gifts-xmas-${mom.personId}.csv"`);
    expect(res.text).not.toContain("Secret ring");
    const rows = parseCsv(res.text).map((r) => r.fields);
    expect(rows[0]).toEqual("season,recipient,title,status,category,wished,priority,est_price,actual_price,store,url,order_number,tracking_url,return_by,from,description".split(","));
    expect(rows).toHaveLength(2);
    const from = [dad.personName, mom.personName].sort((a, b) => a.localeCompare(b)).join(" & ");
    expect(rows[1]).toEqual([
      season.name, kid.name, "'=HYPERLINK(\"http://evil\")", "ordered", "main", "yes", "2", "1234.56", "0.99", "Shop, Inc.", "", "", "", "2030-01-02", from, "line 1\nline \"2\"",
    ]);

    const asDad = await call(`/export.csv?seasonId=${season.id}`, { cookie: dad.cookie });
    expect(asDad.text).toContain("Secret ring");
    const all = await call(`/export.csv`, { cookie: dad.cookie });
    expect(all.headers.get("Content-Disposition")).toBe('attachment; filename="gifts-all.csv"');
    expect((await call(`/export.csv?seasonId=99999999`, { cookie: dad.cookie })).status).toBe(404);
  });

  it("imports with dry run, per-row errors, a batch write and one activity row", async () => {
    const { mom, dad, kid, season, gift } = await setup();
    const csv = [
      "﻿Title,RECIPIENT,Est Price,status,category,from,wished,return_by,description,Extra",
      `Kite,${kid.name.toUpperCase()},"$1,234.50",ordered,toys,${dad.personName} & ${mom.personName.toLowerCase()},yes,12/24/2026,"multi\nline",ignored`,
      `'=cmd,${kid.name},,bogus,,,,,,`,
      ``,
      `Bad one,Nobody Known,,,,,,,,`,
      `,${kid.name},,,,,,,,`,
      `Pricey,${kid.name},abc,,,,,,,`,
      `For santa,Santa,,,,,,,,`,
      `For me,${mom.personName},5,planned,stocking,,,,,`,
    ].join("\r\n");

    const dry = await call("/import", { method: "POST", cookie: mom.cookie, body: { csv, seasonId: season.id, dryRun: true } });
    expect(dry.status).toBe(200);
    expect(dry.body.created).toBe(0);
    expect(dry.body.rows).toEqual([
      { line: 2, ok: true, title: "Kite", recipient: kid.name },
      { line: 4, ok: true, title: "=cmd", recipient: kid.name },
      { line: 6, ok: false, error: 'Unknown person "Nobody Known"', title: "Bad one", recipient: "Nobody Known" },
      { line: 7, ok: false, error: "title is required", recipient: kid.name },
      { line: 8, ok: false, error: `est_price: "abc" isn't a price`, title: "Pricey", recipient: kid.name },
      { line: 9, ok: false, error: "Santa only gives gifts", title: "For santa", recipient: "Santa" },
      { line: 10, ok: true, title: "For me", recipient: mom.personName },
    ]);
    expect((await call(`/gifts?seasonId=${season.id}`, { cookie: dad.cookie })).body).toEqual([]);

    const real = await call("/import", { method: "POST", cookie: mom.cookie, body: { csv, seasonId: season.id, dryRun: false } });
    expect(real.body.created).toBe(3);
    const list = (await call(`/gifts?seasonId=${season.id}`, { cookie: dad.cookie })).body as any[];
    const kite = list.find((g) => g.title === "Kite");
    expect(kite).toMatchObject({
      recipientIds: [kid.id], estPriceCents: 123450, status: "ordered", category: "other", wished: true,
      returnBy: "2026-12-24", description: "multi\nline", createdBy: mom.userId,
      giverIds: [dad.personId, mom.personId].sort((a, b) => a - b),
    });
    expect(list.find((g) => g.title === "=cmd")).toMatchObject({ status: "idea", category: "main", giverIds: [] });
    // Mom imported a gift for herself: it's hidden from her right away.
    expect(list.find((g) => g.title === "For me")).toMatchObject({ recipientIds: [mom.personId], isFamily: false, category: "stocking" });
    expect(((await call(`/gifts?seasonId=${season.id}`, { cookie: mom.cookie })).body as any[]).map((g) => g.title)).not.toContain("For me");

    const feed = (await call(`/activity?seasonId=${season.id}`, { cookie: dad.cookie })).body as any[];
    expect(feed[0]).toMatchObject({ summary: "Imported 3 gifts", action: "created", userId: mom.userId, giftId: null, recipientId: null, recipientIds: [], seasonId: season.id });

    // Round trip: exporting and re-importing works.
    const exported = (await call(`/export.csv?seasonId=${season.id}`, { cookie: dad.cookie })).text;
    const again = await call("/import", { method: "POST", cookie: dad.cookie, body: { csv: exported, seasonId: null, dryRun: true } });
    expect(again.body.rows.every((r: any) => r.ok)).toBe(true);
    expect(again.body.rows.map((r: any) => r.title).sort()).toEqual(["=cmd", "For me", "Kite"]);

    // Whole-file errors are 400s.
    for (const body of [
      { csv: "name,price\nx,1", seasonId: null, dryRun: true },
      { csv: "", seasonId: null, dryRun: true },
      { csv: 'title,recipient\n"unterminated', seasonId: null, dryRun: true },
      { csv: "title,recipient\nA,B", seasonId: 99999999, dryRun: true },
      { csv: "title,recipient\n" + `A,${kid.name}\n`.repeat(1001), seasonId: null, dryRun: true },
    ]) {
      const r = await call("/import", { method: "POST", cookie: dad.cookie, body });
      expect(r.status, body.csv.slice(0, 30)).toBe(400);
      expect(r.body.error).toBeTypeOf("string");
    }
    void gift;
  });
});

describe("dashboard additions and giver-only people", () => {
  it("adds stocking money per person and budget allocation, excluding giver-only people", async () => {
    const { mom, dad, kid, season, gift } = await setup();
    const santa = ((await call("/people", { cookie: dad.cookie })).body as any[]).find((p) => p.name === "Santa");
    expect(santa).toMatchObject({ giverOnly: true, kind: "other" });
    expect(kid.giverOnly).toBe(false);

    await call(`/seasons/${season.id}/budgets/${kid.id}`, { method: "PUT", cookie: dad.cookie, body: { budgetCents: 60000, stockingBudgetCents: 5000 } });
    await call(`/seasons/${season.id}/budgets/${mom.personId}`, { method: "PUT", cookie: dad.cookie, body: { budgetCents: 30000 } });
    await call(`/seasons/${season.id}/budgets/${dad.personId}`, { method: "PUT", cookie: dad.cookie, body: { budgetCents: 25000 } });
    const archived = (await call("/people", { method: "POST", cookie: dad.cookie, body: { name: "Gone", kind: "kid" } })).body;
    await call(`/seasons/${season.id}/budgets/${archived.id}`, { method: "PUT", cookie: dad.cookie, body: { budgetCents: 99900 } });
    await call(`/people/${archived.id}`, { method: "PATCH", cookie: dad.cookie, body: { archived: true } });
    const budgetSanta = await call(`/seasons/${season.id}/budgets/${santa.id}`, { method: "PUT", cookie: dad.cookie, body: { budgetCents: 100 } });
    expect(budgetSanta.status).toBe(400);

    await gift(dad, { title: "Candy", recipientIds: [kid.id], seasonId: season.id, category: "stocking", status: "ordered", estPriceCents: 300, giverIds: [santa.id] });
    await gift(dad, { title: "Yo-yo", recipientIds: [kid.id], seasonId: season.id, category: "stocking", status: "planned", estPriceCents: 700 });
    await gift(dad, { title: "Gum", recipientIds: [kid.id], seasonId: season.id, category: "stocking", status: "idea", estPriceCents: 50 });
    await gift(dad, { title: "Bike", recipientIds: [kid.id], seasonId: season.id, status: "ordered", estPriceCents: 20000 });
    await gift(dad, { title: "Lip balm", recipientIds: [mom.personId], seasonId: season.id, category: "stocking", status: "ordered", estPriceCents: 400 });

    // A giver-only person can't receive gifts.
    expect((await gift(dad, { title: "Cookies", recipientIds: [santa.id], seasonId: season.id })).status).toBe(400);
    const g = (await gift(dad, { title: "Cocoa", recipientIds: [kid.id] })).body;
    expect((await call(`/gifts/${g.id}`, { method: "PATCH", cookie: dad.cookie, body: { recipientIds: [santa.id] } })).status).toBe(400);

    const dm = (await call(`/dashboard?seasonId=${season.id}`, { cookie: mom.cookie })).body;
    // Allocation includes the viewer's own budget; excludes archived and giver-only people.
    expect(dm.totals).toMatchObject({ budgetCents: 100000, allocatedCents: 115000, unallocatedCents: -15000 });
    const kidCard = dm.people.find((p: any) => p.personId === kid.id);
    expect(kidCard).toMatchObject({ stockingSpentCents: 300, stockingCommittedCents: 700, stockingCount: 2, spentCents: 20300, committedCents: 700 });
    expect(dm.people.find((p: any) => p.personId === mom.personId)).toMatchObject({ hidden: true, stockingSpentCents: 0, stockingCommittedCents: 0 });
    expect(dm.people.some((p: any) => p.personId === santa.id)).toBe(false);
    expect(dm.fairness.some((p: any) => p.personId === santa.id)).toBe(false);

    const dd = (await call(`/dashboard?seasonId=${season.id}`, { cookie: dad.cookie })).body;
    expect(dd.people.find((p: any) => p.personId === mom.personId)).toMatchObject({ hidden: false, stockingSpentCents: 400, stockingCommittedCents: 0 });

    // giverOnly can be set on create/patch, but not on someone who already receives gifts.
    const tag = (await call("/people", { method: "POST", cookie: dad.cookie, body: { name: "Elf", kind: "other", giverOnly: true } })).body;
    expect(tag.giverOnly).toBe(true);
    expect((await call(`/people/${kid.id}`, { method: "PATCH", cookie: dad.cookie, body: { giverOnly: true } })).status).toBe(409);
    expect((await call(`/people/${tag.id}`, { method: "PATCH", cookie: dad.cookie, body: { giverOnly: false } })).body.giverOnly).toBe(false);
  });
});
