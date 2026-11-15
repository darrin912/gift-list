import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker/index";
import { addDays, todayUtc } from "../src/worker/rules";
import { call, makeUser } from "./helpers";

const today = todayUtc();

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup() {
  const mom = await makeUser("Mom");
  const dad = await makeUser("Dad");
  const kid = (await call("/people", { method: "POST", cookie: dad.cookie, body: { name: `Ava${mom.personId}`, kind: "kid" } })).body;
  const season = (await call("/seasons", { method: "POST", cookie: dad.cookie, body: { name: `Xmas ${mom.personId}`, date: addDays(today, 30) } })).body;
  const past = (await call("/seasons", { method: "POST", cookie: dad.cookie, body: { name: `Christmas Past ${mom.personId}`, date: addDays(today, -300) } })).body;
  const older = (await call("/seasons", { method: "POST", cookie: dad.cookie, body: { name: `Christmas Older ${mom.personId}`, date: addDays(today, -700) } })).body;
  const gift = async (who: { cookie: string }, body: Record<string, unknown>) => {
    const res = await call("/gifts", { method: "POST", cookie: who.cookie, body });
    expect(res.status).toBe(201);
    return res.body;
  };
  return { mom, dad, kid, season, past, older, gift };
}

function productPage(price: string): Response {
  return new Response(
    `<html><head><title>Thing</title><meta property="product:price:amount" content="${price}"></head><body></body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}

describe("serializers", () => {
  it("Gift and Season JSON include the phase 3 fields", async () => {
    const { dad, kid, season, gift } = await setup();
    const g = await gift(dad, { title: "Robot", recipientId: kid.id, seasonId: season.id, url: "https://shop.example.com/r", watchPrice: true });
    expect(g).toMatchObject({ watchPrice: true, lastSeenPriceCents: null, lowestSeenPriceCents: null, lastCheckedAt: null, priceDroppedAt: null });
    const fetched = (await call(`/gifts/${g.id}`, { cookie: dad.cookie })).body;
    expect(fetched.watchPrice).toBe(true);
    expect(season.honoreeId).toBeNull();
    const patched = (await call(`/gifts/${g.id}`, { method: "PATCH", cookie: dad.cookie, body: { watchPrice: false } })).body;
    expect(patched.watchPrice).toBe(false);
  });
});

describe("history", () => {
  it("groups by season (newest first), skips the active season and the inbox, and applies the surprise rule", async () => {
    const { mom, dad, kid, season, past, older, gift } = await setup();
    const active = (await call("/seasons", { method: "POST", cookie: dad.cookie, body: { name: `Active ${mom.personId}`, date: addDays(today, 10), isActive: true } })).body;
    const a = await gift(dad, { title: "Bike", recipientId: kid.id, seasonId: past.id });
    const b = await gift(dad, { title: "Kite", recipientId: kid.id, seasonId: older.id });
    await gift(dad, { title: "Inbox idea", recipientId: kid.id });
    await gift(dad, { title: "Active one", recipientId: kid.id, seasonId: active.id });
    const future = await gift(dad, { title: "Future", recipientId: kid.id, seasonId: season.id });

    const res = await call(`/history?personId=${kid.id}`, { cookie: mom.cookie });
    expect(res.status).toBe(200);
    expect(res.body.map((h: any) => h.season.id)).toEqual([season.id, past.id, older.id]);
    expect(res.body[0].gifts.map((g: any) => g.id)).toEqual([future.id]);
    expect(res.body[1].gifts.map((g: any) => g.id)).toEqual([a.id]);
    expect(res.body[2].gifts[0]).toMatchObject({ id: b.id, title: "Kite", giverIds: [] });
    expect(res.body[1].season).toMatchObject({ name: past.name, honoreeId: null });

    // Surprise rule: Mom sees her past gifts, never her live-season ones.
    const momPast = await gift(dad, { title: "Scarf", recipientId: mom.personId, seasonId: past.id });
    await gift(dad, { title: "Necklace", recipientId: mom.personId, seasonId: season.id });
    const asMom = (await call(`/history?personId=${mom.personId}`, { cookie: mom.cookie })).body;
    expect(asMom.map((h: any) => h.season.id)).toEqual([past.id]);
    expect(asMom[0].gifts.map((g: any) => g.id)).toEqual([momPast.id]);
    const asDad = (await call(`/history?personId=${mom.personId}`, { cookie: dad.cookie })).body;
    expect(asDad.map((h: any) => h.season.id)).toEqual([season.id, past.id]);

    expect((await call(`/history`, { cookie: mom.cookie })).status).toBe(400);
    expect((await call(`/history?personId=${kid.id}`)).status).toBe(401);
    await call(`/seasons/${active.id}`, { method: "PATCH", cookie: dad.cookie, body: { isActive: false } });
  });
});

describe("similar gifts", () => {
  it("finds the same recipient's similar gifts in other seasons", async () => {
    const { mom, dad, kid, season, past, older, gift } = await setup();
    const lego = await gift(dad, { title: "LEGO Set!", recipientId: kid.id, seasonId: past.id, status: "given" });
    await gift(dad, { title: "lego set", recipientId: kid.id, seasonId: older.id, status: "returned" }); // returned: excluded
    await gift(dad, { title: "LEGO set", recipientId: kid.id, seasonId: older.id, status: "idea" }); // idea: excluded
    const big = await gift(dad, { title: "Big LEGO Set Deluxe", recipientId: kid.id, seasonId: older.id, status: "wrapped" });
    await gift(dad, { title: "LEGO Set", recipientId: kid.id, status: "planned" }); // inbox: excluded
    const current = await gift(dad, { title: "Lego set", recipientId: kid.id, seasonId: season.id, status: "planned" });
    await gift(dad, { title: "LEGO Set", recipientId: mom.personId, seasonId: past.id, status: "given" }); // other recipient

    const q = (params: string, who = dad) => call(`/gifts/similar?${params}`, { cookie: who.cookie });
    const res = await q(`recipientId=${kid.id}&title=${encodeURIComponent("lego  SET")}&seasonId=${season.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { giftId: lego.id, title: "LEGO Set!", seasonName: past.name, seasonDate: past.date, status: "given" },
      { giftId: big.id, title: "Big LEGO Set Deluxe", seasonName: older.name, seasonDate: older.date, status: "wrapped" },
    ]);
    // excludeId: the current gift's own season is "this season".
    const viaExclude = await q(`recipientId=${kid.id}&title=Lego%20set&excludeId=${current.id}`);
    expect(viaExclude.body.map((m: any) => m.giftId)).toEqual([lego.id, big.id]);
    // Too short to match.
    expect((await q(`recipientId=${kid.id}&title=Leg&seasonId=${season.id}`)).body).toEqual([]);
    expect((await q(`title=x`)).status).toBe(400);
  });

  it("respects the surprise rule and the 5-result cap", async () => {
    const { mom, dad, season, past, gift } = await setup();
    const future = (await call("/seasons", { method: "POST", cookie: dad.cookie, body: { name: `Bday ${mom.personId}`, kind: "other", date: addDays(today, 60) } })).body;
    await gift(dad, { title: "Perfume", recipientId: mom.personId, seasonId: future.id, status: "ordered" }); // live: hidden from Mom
    const old = await gift(dad, { title: "Perfume", recipientId: mom.personId, seasonId: past.id, status: "given" });
    const asMom = (await call(`/gifts/similar?recipientId=${mom.personId}&title=perfume&seasonId=${season.id}`, { cookie: mom.cookie })).body;
    expect(asMom.map((m: any) => m.giftId)).toEqual([old.id]);
    const asDad = (await call(`/gifts/similar?recipientId=${mom.personId}&title=perfume&seasonId=${season.id}`, { cookie: dad.cookie })).body;
    expect(asDad).toHaveLength(2);

    for (let i = 0; i < 7; i++) await gift(dad, { title: `Book ${i} box`, recipientId: mom.personId, seasonId: past.id, status: "given" });
    const capped = (await call(`/gifts/similar?recipientId=${mom.personId}&title=book&seasonId=${season.id}`, { cookie: dad.cookie })).body;
    expect(capped).toHaveLength(5);
  });
});

describe("name draw", () => {
  it("draws, replaces, avoids the previous season, and deletes", async () => {
    const { mom, dad, season, past } = await setup();
    const kids = [];
    for (let i = 0; i < 4; i++) kids.push((await call("/people", { method: "POST", cookie: dad.cookie, body: { name: `Kid${i}-${mom.personId}`, kind: "kid" } })).body.id);

    // Last year's draw.
    const prev = await call(`/seasons/${past.id}/draw`, { method: "POST", cookie: dad.cookie, body: { participantIds: kids, avoidPreviousSeason: false } });
    expect(prev.status).toBe(200);
    expect(prev.body.note).toBeUndefined();
    const prevPairs: { giverId: number; recipientId: number }[] = prev.body.pairs;
    expect(prevPairs).toHaveLength(4);

    for (let k = 0; k < 10; k++) {
      const res = await call(`/seasons/${season.id}/draw`, { method: "POST", cookie: mom.cookie, body: { participantIds: kids, avoidPreviousSeason: true } });
      expect(res.status).toBe(200);
      expect(res.body.note).toBeUndefined();
      for (const p of res.body.pairs) {
        expect(p.giverId).not.toBe(p.recipientId);
        expect(prevPairs.some((q) => q.giverId === p.giverId && q.recipientId === p.recipientId)).toBe(false);
      }
      const stored = (await call(`/seasons/${season.id}/draw`, { cookie: dad.cookie })).body;
      expect(stored).toEqual(res.body.pairs); // replaced, both parents see it
    }

    // Two participants with last year's swap: impossible to avoid -> fallback note.
    const two = kids.slice(0, 2);
    await call(`/seasons/${past.id}/draw`, { method: "POST", cookie: dad.cookie, body: { participantIds: two } });
    const fb = await call(`/seasons/${season.id}/draw`, { method: "POST", cookie: dad.cookie, body: { participantIds: two, avoidPreviousSeason: true } });
    expect(fb.body.note).toEqual(expect.any(String));
    expect(fb.body.pairs).toHaveLength(2);

    expect((await call(`/seasons/${season.id}/draw`, { method: "DELETE", cookie: dad.cookie })).body).toEqual({ ok: true });
    expect((await call(`/seasons/${season.id}/draw`, { cookie: dad.cookie })).body).toEqual([]);
  });

  it("validates participants", async () => {
    const { mom, dad, kid, season } = await setup();
    const post = (body: unknown) => call(`/seasons/${season.id}/draw`, { method: "POST", cookie: dad.cookie, body });
    expect((await post({ participantIds: [kid.id] })).status).toBe(400);
    expect((await post({ participantIds: [kid.id, kid.id] })).status).toBe(400);
    expect((await post({ participantIds: [kid.id, 999999] })).status).toBe(400);
    const santa = (await call("/people", { method: "POST", cookie: dad.cookie, body: { name: `Elf${mom.personId}`, kind: "other", giverOnly: true } })).body;
    expect((await post({ participantIds: [kid.id, santa.id] })).status).toBe(400);
    const gone = (await call("/people", { method: "POST", cookie: dad.cookie, body: { name: `Gone${mom.personId}`, kind: "kid", archived: true } })).body;
    expect((await post({ participantIds: [kid.id, gone.id] })).status).toBe(400);
    expect((await call(`/seasons/999999/draw`, { method: "POST", cookie: dad.cookie, body: { participantIds: [kid.id, mom.personId] } })).status).toBe(404);
    expect((await post({ participantIds: [kid.id, mom.personId] })).status).toBe(200);
    // A person in a draw is archived rather than deleted.
    const del = await call(`/people/${kid.id}`, { method: "DELETE", cookie: dad.cookie });
    expect(del.body).toEqual({ ok: true, archived: true });
  });
});

describe("season honoree", () => {
  it("is required for birthdays, optional for anniversaries, refused for Christmas", async () => {
    const { mom, dad, kid } = await setup();
    const post = (body: Record<string, unknown>) => call("/seasons", { method: "POST", cookie: dad.cookie, body: { date: addDays(today, 40), ...body } });
    expect((await post({ kind: "birthday", name: "Bday" })).status).toBe(400);
    expect((await post({ kind: "birthday", name: "Bday", honoreeId: 999999 })).status).toBe(400);
    const santa = (await call("/people", { method: "POST", cookie: dad.cookie, body: { name: `Claus${mom.personId}`, kind: "other", giverOnly: true } })).body;
    expect((await post({ kind: "birthday", name: "Bday", honoreeId: santa.id })).status).toBe(400);
    expect((await post({ kind: "christmas", name: "Xmas", honoreeId: kid.id })).status).toBe(400);
    const bday = await post({ kind: "birthday", name: "Ava's Birthday", honoreeId: kid.id });
    expect(bday.status).toBe(201);
    expect(bday.body.honoreeId).toBe(kid.id);
    const anniv = await post({ kind: "anniversary", name: "Anniversary" });
    expect(anniv.status).toBe(201);
    expect(anniv.body.honoreeId).toBeNull();

    const patch = (id: number, body: Record<string, unknown>) => call(`/seasons/${id}`, { method: "PATCH", cookie: dad.cookie, body });
    expect((await patch(bday.body.id, { honoreeId: null })).status).toBe(400);
    expect((await patch(anniv.body.id, { kind: "birthday" })).status).toBe(400);
    expect((await patch(anniv.body.id, { kind: "birthday", honoreeId: mom.personId })).body.honoreeId).toBe(mom.personId);
    expect((await patch(bday.body.id, { name: "Renamed" })).status).toBe(200);
    // Switching to Christmas clears the honoree.
    const xmas = await patch(bday.body.id, { kind: "christmas" });
    expect(xmas.status).toBe(200);
    expect(xmas.body.honoreeId).toBeNull();
    expect((await call("/seasons", { cookie: dad.cookie })).body.find((s: any) => s.id === anniv.body.id).honoreeId).toBe(mom.personId);
  });
});

describe("price watch", () => {
  it("check-price records a drop (≥ $1 or 5%), writes a system activity row hidden from the recipient", async () => {
    const { mom, dad, season, gift } = await setup();
    const g = await gift(dad, {
      title: "Headphones",
      recipientId: mom.personId,
      seasonId: season.id,
      url: "https://shop.example.com/headphones",
      estPriceCents: 5999,
      watchPrice: true,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => productPage("44.99"));
    const res = await call(`/gifts/${g.id}/check-price`, { method: "POST", cookie: dad.cookie });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe("https://shop.example.com/headphones");
    expect(res.body).toMatchObject({ id: g.id, lastSeenPriceCents: 4499, lowestSeenPriceCents: 4499, priceDroppedAt: expect.any(String), lastCheckedAt: expect.any(String) });
    const droppedAt = res.body.priceDroppedAt;

    const feed = (await call(`/activity?seasonId=${season.id}`, { cookie: dad.cookie })).body as any[];
    expect(feed[0]).toMatchObject({ userId: null, userName: "Price watch", action: "updated", giftId: g.id, summary: `Price dropped on "Headphones": $59.99 → $44.99` });
    const momFeed = (await call(`/activity?limit=100`, { cookie: mom.cookie })).body as any[];
    expect(momFeed.some((a) => a.giftId === g.id)).toBe(false);
    // Mom can't check her own surprise.
    expect((await call(`/gifts/${g.id}/check-price`, { method: "POST", cookie: mom.cookie })).status).toBe(404);

    // 44.99 -> 44.50: 49¢ and ~1.1%: not a drop.
    fetchSpy.mockImplementation(async () => productPage("44.50"));
    const small = (await call(`/gifts/${g.id}/check-price`, { method: "POST", cookie: dad.cookie })).body;
    expect(small).toMatchObject({ lastSeenPriceCents: 4450, lowestSeenPriceCents: 4450, priceDroppedAt: droppedAt });
    // A rise keeps the lowest price.
    fetchSpy.mockImplementation(async () => productPage("50.00"));
    const rise = (await call(`/gifts/${g.id}/check-price`, { method: "POST", cookie: dad.cookie })).body;
    expect(rise).toMatchObject({ lastSeenPriceCents: 5000, lowestSeenPriceCents: 4450 });
    // Failure: price kept, last_checked_at still updated.
    fetchSpy.mockImplementation(async () => {
      throw new TypeError("network");
    });
    const failed = (await call(`/gifts/${g.id}/check-price`, { method: "POST", cookie: dad.cookie })).body;
    expect(failed.lastSeenPriceCents).toBe(5000);
    expect(failed.lastCheckedAt >= rise.lastCheckedAt).toBe(true);
    const drops = (await call(`/activity?seasonId=${season.id}`, { cookie: dad.cookie })).body.filter((a: any) => a.userName === "Price watch");
    expect(drops).toHaveLength(1);
  });

  it("first check without an estimate is not a drop; 400 without a URL; 10 per user per minute", async () => {
    const { dad, kid, season, gift } = await setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => productPage("19.99"));
    const g = await gift(dad, { title: "Puzzle", recipientId: kid.id, seasonId: season.id, url: "https://shop.example.com/p" });
    const first = (await call(`/gifts/${g.id}/check-price`, { method: "POST", cookie: dad.cookie })).body;
    expect(first).toMatchObject({ lastSeenPriceCents: 1999, priceDroppedAt: null });
    const noUrl = await gift(dad, { title: "No link", recipientId: kid.id, seasonId: season.id });
    expect((await call(`/gifts/${noUrl.id}/check-price`, { method: "POST", cookie: dad.cookie })).status).toBe(400);
    const bad = await gift(dad, { title: "Local", recipientId: kid.id, seasonId: season.id, url: "http://127.0.0.1/x" });
    expect((await call(`/gifts/${bad.id}/check-price`, { method: "POST", cookie: dad.cookie })).status).toBe(400);
    for (let i = 0; i < 9; i++) expect((await call(`/gifts/${g.id}/check-price`, { method: "POST", cookie: dad.cookie })).status).toBe(200);
    const limited = await call(`/gifts/${g.id}/check-price`, { method: "POST", cookie: dad.cookie });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
  });

  it("the scheduled handler checks at most 25 eligible gifts, oldest checked first", async () => {
    const { dad, kid, season, gift } = await setup();
    const mine: { id: number; url: string }[] = [];
    for (let i = 0; i < 30; i++) {
      const url = `https://shop.example.com/item/${i}`;
      mine.push({ id: (await gift(dad, { title: `Item ${i}`, recipientId: kid.id, seasonId: season.id, url, estPriceCents: 10000, watchPrice: true, status: i % 2 ? "idea" : "planned" })).id, url });
    }
    // Not eligible: not watched, no URL, wrong status.
    const skipped = [
      await gift(dad, { title: "Unwatched", recipientId: kid.id, url: "https://shop.example.com/u", status: "idea" }),
      await gift(dad, { title: "No URL", recipientId: kid.id, watchPrice: true, status: "idea" }),
      await gift(dad, { title: "Ordered", recipientId: kid.id, url: "https://shop.example.com/o", watchPrice: true, status: "ordered" }),
    ];
    // Isolate from other tests' watched gifts.
    const ids = mine.map((m) => m.id);
    await env.DB.prepare(`UPDATE gifts SET watch_price = 0 WHERE id NOT IN (${ids.join(",")}) AND title <> 'No URL' AND title <> 'Ordered'`).run();
    // Items 0..9 were checked recently, 10..29 long ago (oldest = highest index); none are null.
    for (let i = 0; i < 30; i++) {
      const at = i < 10 ? new Date(Date.now() - i * 1000).toISOString() : `2020-01-${String(31 - (i - 10)).padStart(2, "0")}T00:00:00.000Z`;
      await env.DB.prepare("UPDATE gifts SET last_checked_at = ? WHERE id = ?").bind(at, ids[i]).run();
    }

    const fetched: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const u = String(input instanceof Request ? input.url : input);
      fetched.push(u);
      return u.endsWith("/29") ? new Response("down", { status: 500 }) : productPage("80.00");
    });
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "17 13 * * *", scheduledTime: Date.now() }), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(fetched).toHaveLength(25);
    // Oldest first: 29, 28, ..., 10 (20 gifts), then the 5 least recently checked of 0..9 (9, 8, 7, 6, 5).
    const expectedOrder = [...Array.from({ length: 20 }, (_, k) => 29 - k), 9, 8, 7, 6, 5];
    expect(fetched).toEqual(expectedOrder.map((i) => mine[i]!.url));
    expect(fetched.some((u) => skipped.some((s) => s.url && u === s.url))).toBe(false);

    const row = await env.DB.prepare("SELECT last_seen_price_cents, price_dropped_at, last_checked_at FROM gifts WHERE id = ?").bind(ids[10]).first<any>();
    expect(row.last_seen_price_cents).toBe(8000);
    expect(row.price_dropped_at).not.toBeNull();
    const failedRow = await env.DB.prepare("SELECT last_seen_price_cents, last_checked_at FROM gifts WHERE id = ?").bind(ids[29]).first<any>();
    expect(failedRow.last_seen_price_cents).toBeNull();
    expect(failedRow.last_checked_at > "2021").toBe(true); // still updated
    const untouched = await env.DB.prepare("SELECT last_seen_price_cents FROM gifts WHERE id = ?").bind(ids[0]).first<any>();
    expect(untouched.last_seen_price_cents).toBeNull();
  });
});
