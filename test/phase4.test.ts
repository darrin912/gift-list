// Phase 4: My wishlist. The owner must never learn anything about the planning or purchase state
// of their own wishlist items: /wishlist responses, status codes, ordering and errors are the same
// whatever the spouse does within the contract, and every other route keeps the items hidden.
import { describe, expect, it } from "vitest";
import { addDays, todayUtc } from "../src/worker/rules";
import { call, makeUser } from "./helpers";

const today = todayUtc();
type Who = { cookie: string };

async function setup() {
  const owner = await makeUser("Darrin");
  const spouse = await makeUser("Stephanie");
  const n = owner.personId;
  const season = async (name: string, date: string, extra: Record<string, unknown> = {}) =>
    (await call("/seasons", { method: "POST", cookie: spouse.cookie, body: { name: `${name} ${n}`, date, ...extra } })).body;
  const s1 = await season("Xmas", addDays(today, 30), { overallBudgetCents: 100000 });
  const s2 = await season("Bday", addDays(today, 60), { kind: "birthday", honoreeId: owner.personId });
  const past = await season("Past", addDays(today, -200));
  const archived = await season("Old", addDays(today, 10), { archived: true });
  const kid = (await call("/people", { method: "POST", cookie: spouse.cookie, body: { name: `Kid${n}`, kind: "kid" } })).body;
  const wish = async (body: Record<string, unknown>) => {
    const res = await call("/wishlist", { method: "POST", cookie: owner.cookie, body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const patchGift = async (id: number, body: Record<string, unknown>) => {
    const res = await call(`/gifts/${id}`, { method: "PATCH", cookie: spouse.cookie, body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  };
  return { owner, spouse, s1, s2, past, archived, kid, wish, patchGift };
}

/** Drops the fields that legitimately differ between two otherwise identical items. */
function norm(x: any): any {
  if (Array.isArray(x)) return x.map(norm);
  if (x && typeof x === "object") {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = x;
    return rest;
  }
  return x;
}

/** Everything the owner can read: compared byte for byte before and after the spouse's planning. */
async function ownerViews(who: Who, ctx: { s1: any; s2: any; personId: number }, titles: string[]) {
  const paths = [
    "/wishlist",
    "/gifts",
    "/gifts?seasonId=none",
    `/gifts?seasonId=${ctx.s1.id}`,
    `/gifts?seasonId=${ctx.s2.id}`,
    "/gifts?wishlist=1",
    `/gifts?recipientId=${ctx.personId}`,
    `/dashboard?seasonId=${ctx.s1.id}`,
    `/dashboard?seasonId=${ctx.s2.id}`,
    "/activity?limit=100",
    `/history?personId=${ctx.personId}`,
    "/export.csv",
    `/export.csv?seasonId=${ctx.s1.id}`,
    "/stores",
    `/seasons/${ctx.s1.id}/draw`,
    ...titles.map((t) => `/gifts/similar?recipientIds=${ctx.personId}&title=${encodeURIComponent(t)}`),
  ];
  const out: Record<string, string> = {};
  for (const p of paths) {
    const res = await call(p, { cookie: who.cookie });
    out[p] = `${res.status} ${res.text}`;
  }
  return out;
}

describe("wishlist: the owner's routes", () => {
  it("creates, lists newest first, and returns only the WishItem fields", async () => {
    const { owner, s1, wish } = await setup();
    const a = await wish({ title: "Wool socks", url: "https://shop.example.com/socks", estPriceCents: 2500, priority: 1 });
    const b = await wish({ title: "Camera strap", description: "**brown** leather", seasonId: s1.id, category: "other" });
    expect(Object.keys(a).sort()).toEqual(
      ["id", "title", "description", "url", "imageUrl", "category", "priority", "estPriceCents", "seasonId", "createdAt", "updatedAt"].sort(),
    );
    expect(a).toMatchObject({ title: "Wool socks", priority: 1, estPriceCents: 2500, seasonId: null, category: "main" });
    const list = (await call("/wishlist", { cookie: owner.cookie })).body;
    expect(list.map((w: any) => w.id)).toEqual([b.id, a.id]);
    expect(list[0]).toEqual(b);
  });

  it("validates: only WishItem fields, seasons must be upcoming", async () => {
    const { owner, past, archived, s1, wish } = await setup();
    for (const body of [
      {},
      { title: "" },
      { title: "x", status: "ordered" },
      { title: "x", store: "REI" },
      { title: "x", giverIds: [] },
      { title: "x", seasonId: past.id },
      { title: "x", seasonId: archived.id },
      { title: "x", seasonId: 99999999 },
      { title: "x", priority: 7 },
    ]) {
      const res = await call("/wishlist", { method: "POST", cookie: owner.cookie, body });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const w = await wish({ title: "Ok", seasonId: s1.id });
    expect(w.seasonId).toBe(s1.id);
    expect((await call(`/wishlist/${w.id}`, { method: "PATCH", cookie: owner.cookie, body: { status: "idea" } })).status).toBe(400);
    expect((await call(`/wishlist/${w.id}`, { method: "PATCH", cookie: owner.cookie, body: { seasonId: past.id } })).status).toBe(400);
  });

  it("only reaches the owner's own, non-withdrawn wishes (404 otherwise)", async () => {
    const { owner, spouse, s1, wish } = await setup();
    const mine = await wish({ title: "Mine" });
    // A wished gift the spouse created for the owner is not a wishlist item: fully hidden.
    const surprise = (
      await call("/gifts", { method: "POST", cookie: spouse.cookie, body: { title: "Surprise", recipientIds: [owner.personId], wished: true, seasonId: s1.id } })
    ).body;
    const spouseWish = (await call("/wishlist", { method: "POST", cookie: spouse.cookie, body: { title: "Hers" } })).body;
    const ids = (await call("/wishlist", { cookie: owner.cookie })).body.map((w: any) => w.id);
    expect(ids).toEqual([mine.id]);
    for (const id of [surprise.id, spouseWish.id, 99999999]) {
      for (const method of ["PATCH", "DELETE"]) {
        const res = await call(`/wishlist/${id}`, { method, cookie: owner.cookie, body: method === "PATCH" ? { title: "x" } : undefined });
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: "Wish not found" });
      }
    }
  });
});

describe("wishlist: hidden from the owner everywhere else", () => {
  it("never appears in /gifts, gift reads/writes, dashboard, activity, history, similar, export or stores", async () => {
    const { owner, spouse, s1, wish, patchGift } = await setup();
    const w = await wish({ title: "Espresso machine", seasonId: s1.id, estPriceCents: 30000 });
    await patchGift(w.id, { status: "ordered", store: `Secret Store ${owner.personId}`, actualPriceCents: 27500 });

    const gifts = (await call("/gifts", { cookie: owner.cookie })).body;
    expect(gifts.map((g: any) => g.id)).not.toContain(w.id);
    expect((await call(`/gifts?wishlist=1&recipientId=${owner.personId}`, { cookie: owner.cookie })).body).toEqual([]);
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const res = await call(`/gifts/${w.id}`, { method, cookie: owner.cookie, body: method === "PATCH" ? { title: "x" } : undefined });
      expect(res.status).toBe(404);
    }
    const dash = (await call(`/dashboard?seasonId=${s1.id}`, { cookie: owner.cookie })).body;
    expect(dash.totals).toMatchObject({ spentCents: 0, committedCents: 0, giftCount: 0 });
    expect(dash.people.find((p: any) => p.personId === owner.personId)).toMatchObject({ hidden: true, spentCents: 0 });
    expect(JSON.stringify(dash.attention)).not.toContain("Espresso");
    expect(JSON.stringify((await call("/activity?limit=100", { cookie: owner.cookie })).body)).not.toContain("Espresso");
    expect((await call(`/history?personId=${owner.personId}`, { cookie: owner.cookie })).body).toEqual([]);
    expect((await call(`/gifts/similar?recipientIds=${owner.personId}&title=Espresso%20machine`, { cookie: owner.cookie })).body).toEqual([]);
    expect((await call("/export.csv", { cookie: owner.cookie })).text).not.toContain("Espresso");
    expect((await call("/stores", { cookie: owner.cookie })).body).not.toContain(`Secret Store ${owner.personId}`);
    // ...while the spouse sees all of it.
    expect((await call("/stores", { cookie: spouse.cookie })).body).toContain(`Secret Store ${owner.personId}`);
    expect((await call(`/dashboard?seasonId=${s1.id}`, { cookie: spouse.cookie })).body.totals.spentCents).toBe(27500);
  });

  it("a gift the owner creates for themselves alone via /gifts becomes a wishlist item", async () => {
    const { owner, spouse, kid } = await setup();
    const res = await call("/gifts", { method: "POST", cookie: owner.cookie, body: { title: "Headphones", recipientIds: [owner.personId] } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ wished: true, isWishlistItem: true, withdrawnAt: null });
    expect((await call("/wishlist", { cookie: owner.cookie })).body.map((w: any) => w.id)).toEqual([res.body.id]);
    // Shared and family gifts are never wishlist items.
    const shared = (
      await call("/gifts", { method: "POST", cookie: owner.cookie, body: { title: "Shared", recipientIds: [owner.personId, kid.id], wished: true } })
    ).body;
    expect(shared.isWishlistItem).toBe(false);
    const fam = (await call("/gifts", { method: "POST", cookie: owner.cookie, body: { title: "Fam", isFamily: true, wished: true } })).body;
    expect(fam.isWishlistItem).toBe(false);
    expect((await call("/wishlist", { cookie: owner.cookie })).body).toHaveLength(1);
    const forSpouse = (await call("/gifts", { cookie: spouse.cookie })).body.find((g: any) => g.id === res.body.id);
    expect(forSpouse).toMatchObject({ isWishlistItem: true, createdBy: owner.userId });
  });
});

describe("wishlist: nothing the spouse does leaks to the owner", () => {
  it("every owner-visible response is byte-identical after the spouse plans, buys, wraps and moves items", async () => {
    const { owner, spouse, s1, s2, kid, wish, patchGift } = await setup();
    const a = await wish({ title: "Trail running shoes", estPriceCents: 12000 });
    const b = await wish({ title: "Board game night", seasonId: s1.id });
    const c = await wish({ title: "Fancy olive oil", seasonId: s1.id, priority: 3 });
    // Something ordinary the owner can see, so the comparisons aren't of empty lists.
    await call("/gifts", { method: "POST", cookie: owner.cookie, body: { title: "Kid bike", recipientIds: [kid.id], seasonId: s1.id, status: "ordered", store: "Bikes" } });
    const titles = ["Trail running shoes", "Board game night", "Fancy olive oil"];
    const ctx = { s1, s2, personId: owner.personId };
    const before = await ownerViews(owner, ctx, titles);

    // Planning and buying, within the contract.
    await patchGift(a.id, { status: "planned", seasonId: s1.id });
    await patchGift(a.id, {
      status: "ordered",
      store: "Bikes", // a store the owner already sees: its count must not change for them
      actualPriceCents: 9999,
      giverIds: [spouse.personId, kid.id],
      orderNumber: "A-1",
      trackingUrl: "https://track.example.com/1",
      returnBy: addDays(today, 3),
      watchPrice: true,
      priority: 1,
    });
    await patchGift(a.id, { seasonId: s2.id }); // moved between live seasons
    await patchGift(b.id, { status: "wrapped", actualPriceCents: 4000, store: `Only here ${owner.personId}` });
    await patchGift(c.id, { status: "given", seasonId: null });
    await patchGift(c.id, { status: "returned", title: "Olive oil (returned)", description: "spouse notes", estPriceCents: 1 });

    const after = await ownerViews(owner, ctx, titles);
    for (const p of Object.keys(before)) expect(after[p], p).toBe(before[p]);
  });

  it("PATCH and DELETE answer identically for an untouched wish and a bought one", async () => {
    const { owner, spouse, s1, s2, past, kid, wish, patchGift } = await setup();
    const untouched = await wish({ title: "Same", estPriceCents: 5000 });
    const bought = await wish({ title: "Same", estPriceCents: 5000 });
    await patchGift(bought.id, {
      status: "wrapped",
      seasonId: s1.id,
      store: "Store",
      actualPriceCents: 4500,
      giverIds: [kid.id],
      returnBy: addDays(today, -1),
    });

    const same = async (method: string, body?: unknown) => {
      const r1 = await call(`/wishlist/${untouched.id}`, { method, cookie: owner.cookie, body });
      const r2 = await call(`/wishlist/${bought.id}`, { method, cookie: owner.cookie, body });
      expect(r2.status).toBe(r1.status);
      expect(norm(r2.body)).toEqual(norm(r1.body));
      expect([...r2.headers.keys()].sort()).toEqual([...r1.headers.keys()].sort());
      return [r1, r2] as const;
    };
    // Errors first: they depend only on the body.
    await same("PATCH", { seasonId: past.id });
    await same("PATCH", { status: "idea" });
    await same("PATCH", { title: "" });
    // A real edit, including a season move (the owner's choice is what they see back).
    const [p1] = await same("PATCH", { title: "Renamed", seasonId: s2.id, priority: 1 });
    expect(p1.status).toBe(200);
    expect(p1.body).toMatchObject({ title: "Renamed", seasonId: s2.id, priority: 1, estPriceCents: 5000 });
    await same("PATCH", {}); // no-op
    const list = (await call("/wishlist", { cookie: owner.cookie })).body;
    expect(list.map((w: any) => w.id)).toEqual([bought.id, untouched.id]);
    expect(norm(list[0])).toEqual(norm(list[1]));
    // The bought gift kept the spouse's season; the untouched one followed the owner.
    const spouseView = async (id: number) => (await call(`/gifts/${id}`, { cookie: spouse.cookie })).body;
    expect((await spouseView(bought.id)).seasonId).toBe(s1.id);
    expect((await spouseView(untouched.id)).seasonId).toBe(s2.id);
    expect((await spouseView(bought.id)).title).toBe("Renamed");

    // DELETE always soft-withdraws, whatever the status.
    const [d1] = await same("DELETE");
    expect(d1.status).toBe(200);
    expect(d1.body).toEqual({ ok: true });
    expect((await call("/wishlist", { cookie: owner.cookie })).body).toEqual([]);
    await same("DELETE"); // now 404 for both
    await same("PATCH", { title: "Again" });
    for (const id of [untouched.id, bought.id]) {
      const g = await spouseView(id);
      expect(g.withdrawnAt).toEqual(expect.any(String));
      expect(g.isWishlistItem).toBe(true);
    }
    expect((await spouseView(bought.id)).status).toBe("wrapped");
    expect((await spouseView(untouched.id)).status).toBe("idea");
  });

  it("an idea, a bought gift and a returned gift all withdraw the same way", async () => {
    const { owner, spouse, s1, wish, patchGift } = await setup();
    const ws = [await wish({ title: "One" }), await wish({ title: "Two" }), await wish({ title: "Three" })];
    await patchGift(ws[1].id, { status: "given", seasonId: s1.id, actualPriceCents: 100 });
    await patchGift(ws[2].id, { status: "returned" });
    for (const w of ws) {
      const res = await call(`/wishlist/${w.id}`, { method: "DELETE", cookie: owner.cookie });
      expect(`${res.status} ${res.text}`).toBe('200 {"ok":true}');
    }
    const ids = (await call("/gifts", { cookie: spouse.cookie })).body.map((g: any) => g.id);
    for (const w of ws) expect(ids).toContain(w.id); // never hard-deleted
  });

  it("membership is fixed by the owner: no spouse action changes the owner's /wishlist", async () => {
    const { owner, spouse, s1, past, kid, wish, patchGift } = await setup();
    const ws: any[] = [];
    for (const t of ["Add recipient", "Clear wished", "Live season", "Past season", "Hard delete", "Family", "Away"]) {
      ws.push(await wish({ title: `${t} ${owner.personId}`, estPriceCents: 1000 }));
    }
    const view = async () => {
      const r = await call("/wishlist", { cookie: owner.cookie });
      return `${r.status} ${r.text}`;
    };
    const before = await view();
    const steps: [string, () => Promise<unknown>][] = [
      ["add a recipient", () => patchGift(ws[0].id, { recipientIds: [owner.personId, kid.id] })],
      ["clear wished", () => patchGift(ws[1].id, { wished: false })],
      ["move to a live season", () => patchGift(ws[2].id, { seasonId: s1.id, status: "ordered" })],
      ["move to a past season", () => patchGift(ws[3].id, { seasonId: past.id, status: "given" })],
      ["hard delete", async () => expect((await call(`/gifts/${ws[4].id}`, { method: "DELETE", cookie: spouse.cookie })).status).toBe(200)],
      ["make it a family gift", () => patchGift(ws[5].id, { isFamily: true })],
      ["give it to someone else", () => patchGift(ws[6].id, { recipientIds: [kid.id] })],
    ];
    for (const [label, step] of steps) {
      await step();
      expect(await view(), label).toBe(before);
    }
    expect(JSON.parse(before.slice(4))).toHaveLength(7);

    // PATCH and DELETE still behave identically on every one of them (compared with a fresh twin).
    const twin = await wish({ title: "Twin", estPriceCents: 1000 });
    const t = await call(`/wishlist/${twin.id}`, { method: "PATCH", cookie: owner.cookie, body: { priority: 1, title: "Edited" } });
    for (const w of ws) {
      const r = await call(`/wishlist/${w.id}`, { method: "PATCH", cookie: owner.cookie, body: { priority: 1, title: "Edited" } });
      expect(r.status).toBe(t.status);
      expect(norm(r.body)).toEqual(norm(t.body));
    }
    const td = await call(`/wishlist/${twin.id}`, { method: "DELETE", cookie: owner.cookie });
    for (const w of ws) {
      const r = await call(`/wishlist/${w.id}`, { method: "DELETE", cookie: owner.cookie });
      expect(`${r.status} ${r.text}`).toBe(`${td.status} ${td.text}`);
    }
    expect((await call("/wishlist", { cookie: owner.cookie })).body).toEqual([]);

    // The gift itself still follows the surprise rule: hidden while its season is live (or it's
    // shared with the owner), shown normally once its season is past.
    const visible = (await call("/gifts", { cookie: owner.cookie })).body.map((g: any) => g.id);
    expect(visible).not.toContain(ws[0].id);
    expect(visible).not.toContain(ws[2].id);
    expect(visible).toContain(ws[3].id);
    // The spouse's views treat the deleted gift as deleted.
    expect((await call(`/gifts/${ws[4].id}`, { cookie: spouse.cookie })).status).toBe(404);
    // Activity about the owner's own wishlist actions stays hidden from the owner.
    const ownerFeed = JSON.stringify((await call("/activity?limit=100", { cookie: owner.cookie })).body);
    expect(ownerFeed).not.toContain(`wishlist item "Edited"`);
  });

  it("a wish leaves the owner's list only when the season the OWNER chose is past or archived", async () => {
    const { owner, spouse, wish, patchGift } = await setup();
    const n = owner.personId;
    const own = (await call("/seasons", { method: "POST", cookie: owner.cookie, body: { name: `Own ${n}`, date: addDays(today, 5) } })).body;
    const a = await wish({ title: "In own season", seasonId: own.id });
    const b = await wish({ title: "Moved by spouse" });
    await patchGift(b.id, { seasonId: own.id }); // the spouse's move doesn't count
    await call(`/seasons/${own.id}`, { method: "PATCH", cookie: spouse.cookie, body: { archived: true } });
    const ids = (await call("/wishlist", { cookie: owner.cookie })).body.map((w: any) => w.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(a.id);
  });
});

describe("wishlist: the spouse's view", () => {
  it("GET /users lists display names (no emails) for the wishlist badge", async () => {
    const { owner, spouse } = await setup();
    const list = (await call("/users", { cookie: spouse.cookie })).body;
    expect(list).toEqual(expect.arrayContaining([{ id: owner.userId, displayName: "Darrin", personId: owner.personId }]));
    expect(JSON.stringify(list)).not.toContain("@");
    expect((await call("/users")).status).toBe(401);
  });

  it("shows the flag, filter, activity wording and withdrawn-wish attention", async () => {
    const { owner, spouse, s1, kid, wish, patchGift } = await setup();
    const a = await wish({ title: "Bought then withdrawn", seasonId: s1.id });
    const b = await wish({ title: "Idea then withdrawn", seasonId: s1.id });
    await call(`/wishlist/${b.id}`, { method: "PATCH", cookie: owner.cookie, body: { priority: 1 } });
    await call("/gifts", { method: "POST", cookie: spouse.cookie, body: { title: "Not a wish", recipientIds: [kid.id], seasonId: s1.id, wished: true } });
    await patchGift(a.id, { status: "ordered", store: "Shop" });
    await call(`/wishlist/${a.id}`, { method: "DELETE", cookie: owner.cookie });
    await call(`/wishlist/${b.id}`, { method: "DELETE", cookie: owner.cookie });

    const filtered = (await call(`/gifts?wishlist=1&seasonId=${s1.id}`, { cookie: spouse.cookie })).body;
    expect(filtered.map((g: any) => g.id).sort()).toEqual([a.id, b.id].sort());
    expect(filtered.every((g: any) => g.isWishlistItem && g.withdrawnAt)).toBe(true);
    const nonWish = (await call(`/gifts?wishlist=0&seasonId=${s1.id}`, { cookie: spouse.cookie })).body;
    expect(nonWish.map((g: any) => g.title)).toEqual(["Not a wish"]);
    expect(nonWish[0].isWishlistItem).toBe(false);

    const summaries = (await call("/activity?limit=100", { cookie: spouse.cookie })).body.map((r: any) => r.summary);
    expect(summaries).toEqual(
      expect.arrayContaining([
        'Added "Bought then withdrawn" to their wishlist',
        'Updated wishlist item "Idea then withdrawn"',
        'Removed "Bought then withdrawn" from their wishlist',
        'Removed "Idea then withdrawn" from their wishlist',
      ]),
    );
    // (The test database is shared, so other tests' wishlists may show up; this owner's never do.)
    const ownerSummaries = (await call("/activity?limit=100", { cookie: owner.cookie })).body.map((r: any) => r.summary).join("\n");
    expect(ownerSummaries).not.toContain("withdrawn");
    expect(ownerSummaries).toContain('Added "Not a wish"');

    const attention = (await call(`/dashboard?seasonId=${s1.id}`, { cookie: spouse.cookie })).body.attention;
    expect(attention.withdrawnWishes).toEqual([
      expect.objectContaining({ giftId: a.id, title: "Bought then withdrawn", status: "ordered", store: "Shop", recipientIds: [owner.personId] }),
    ]);
    expect((await call(`/dashboard?seasonId=${s1.id}`, { cookie: owner.cookie })).body.attention.withdrawnWishes).toEqual([]);
    // Bought-then-withdrawn still counts toward money until it's returned.
    expect((await call(`/dashboard?seasonId=${s1.id}`, { cookie: spouse.cookie })).body.totals.giftCount).toBe(1);
  });
});
