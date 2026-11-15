import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hashPassword } from "../src/worker/crypto";
import { addDays, todayUtc } from "../src/worker/rules";
import { call, makeUser, nextN } from "./helpers";

describe("auth", () => {
  it("requires a session everywhere except login", async () => {
    for (const p of ["/auth/me", "/people", "/seasons", "/gifts", "/stores", "/dashboard", "/activity", "/export.csv", "/nope"]) {
      const res = await call(p);
      expect(res.status, p).toBe(401);
      expect(res.body).toEqual({ error: expect.any(String) });
    }
  });

  it("logs in with a secure session cookie and logs out", async () => {
    const n = nextN();
    const email = `cookie${n}@example.com`;
    const h = await hashPassword("password1234", 1000);
    await env.DB.prepare(
      "INSERT INTO users (email, display_name, password_hash, password_salt, password_iterations) VALUES (?, 'C', ?, ?, ?)",
    )
      .bind(email, h.hash, h.salt, h.iterations)
      .run();
    const res = await call("/auth/login", { method: "POST", body: { email, password: "password1234" }, ip: "192.0.2.50" });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email, displayName: "C", personId: null });
    const sc = res.headers.get("Set-Cookie")!;
    expect(sc).toMatch(/^gl_session=[A-Za-z0-9_-]{43};/);
    expect(sc).toContain("Max-Age=7776000");
    expect(sc).toContain("Path=/");
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("Secure");
    expect(sc).toContain("SameSite=Lax");
    const cookie = sc.split(";")[0]!;

    expect((await call("/auth/me", { cookie })).body.user.email).toBe(email);
    const out = await call("/auth/logout", { method: "POST", cookie });
    expect(out.body).toEqual({ ok: true });
    expect(out.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await call("/auth/me", { cookie })).status).toBe(401);
  });

  it("rate-limits after 5 failures per email", async () => {
    const u = await makeUser("Rate");
    for (let i = 0; i < 5; i++) {
      const r = await call("/auth/login", { method: "POST", body: { email: u.email, password: "wrong-password" }, ip: `10.0.0.${i}` });
      expect(r.status).toBe(401);
    }
    const blocked = await call("/auth/login", { method: "POST", body: { email: u.email, password: "password1234" }, ip: "10.0.1.1" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBeTypeOf("string");
  });

  it("rate-limits after 5 failures per IP", async () => {
    for (let i = 0; i < 5; i++) {
      await call("/auth/login", { method: "POST", body: { email: `nobody${i}@example.com`, password: "x" }, ip: "10.9.9.9" });
    }
    const u = await makeUser("Ip");
    const blocked = await call("/auth/login", { method: "POST", body: { email: u.email, password: "password1234" }, ip: "10.9.9.9" });
    expect(blocked.status).toBe(429);
  });

  it("changes the password", async () => {
    const u = await makeUser("Pw");
    expect((await call("/auth/password", { method: "POST", cookie: u.cookie, body: { currentPassword: "password1234", newPassword: "short" } })).status).toBe(400);
    expect((await call("/auth/password", { method: "POST", cookie: u.cookie, body: { currentPassword: "nope-nope-nope", newPassword: "newpassword99" } })).status).toBe(400);
    const ok = await call("/auth/password", { method: "POST", cookie: u.cookie, body: { currentPassword: "password1234", newPassword: "newpassword99" } });
    expect(ok.body).toEqual({ ok: true });
    const relog = await call("/auth/login", { method: "POST", body: { email: u.email, password: "newpassword99" }, ip: "10.7.7.7" });
    expect(relog.status).toBe(200);
  });
});

describe("gifts, dashboard and the surprise rule", () => {
  it("hides a user's own gifts everywhere and keeps money totals consistent", async () => {
    const mom = await makeUser("Mom");
    const dad = await makeUser("Dad");
    const today = todayUtc();

    // Validation errors are { error } with 400.
    const bad = await call("/people", { method: "POST", cookie: dad.cookie, body: { kind: "kid" } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/name/);

    const kid = (await call("/people", { method: "POST", cookie: dad.cookie, body: { name: "Emma", kind: "kid", sizes: { shirt: "8" } } })).body;
    expect(kid).toMatchObject({ name: "Emma", kind: "kid", sizes: { shirt: "8" }, archived: false, birthday: null });

    const season = (
      await call("/seasons", {
        method: "POST",
        cookie: dad.cookie,
        body: { kind: "christmas", name: "Christmas test", date: addDays(today, 30), overallBudgetCents: 100000, isActive: true },
      })
    ).body;
    expect(season.isActive).toBe(true);
    const past = (await call("/seasons", { method: "POST", cookie: dad.cookie, body: { name: "Past", date: addDays(today, -1) } })).body;

    expect((await call(`/seasons/${season.id}/budgets/${kid.id}`, { method: "PUT", cookie: dad.cookie, body: { budgetCents: 30000, stockingBudgetCents: 5000 } })).body).toEqual({
      personId: kid.id,
      budgetCents: 30000,
      stockingBudgetCents: 5000,
    });
    await call(`/seasons/${season.id}/budgets/${mom.personId}`, { method: "PUT", cookie: dad.cookie, body: { budgetCents: 20000 } });

    const mk = (who: { cookie: string }, body: Record<string, unknown>) => call("/gifts", { method: "POST", cookie: who.cookie, body });

    const planned = await mk(dad, { title: "Lego", recipientId: kid.id, seasonId: season.id, status: "planned", estPriceCents: 4000, giverIds: [dad.personId, mom.personId], store: "Target" });
    expect(planned.status).toBe(201);
    expect(planned.body).toMatchObject({ title: "Lego", giverIds: [mom.personId, dad.personId].sort((a, b) => a - b), createdBy: dad.userId, wished: false, priority: 2, category: "main" });
    const ordered = (await mk(dad, { title: "Bike", recipientId: kid.id, seasonId: season.id, status: "ordered", estPriceCents: 9000, actualPriceCents: 8500, returnBy: addDays(today, -1), store: "REI" })).body;
    await mk(dad, { title: "Socks", recipientId: kid.id, seasonId: season.id, status: "received", category: "stocking", estPriceCents: 500 });
    await mk(dad, { title: "Idea only", recipientId: kid.id, seasonId: season.id, status: "idea", estPriceCents: 99999 });
    // Gifts for Mom: current season (hidden), ideas inbox (hidden), past season (visible).
    const momGift = (await mk(dad, { title: "Necklace", recipientId: mom.personId, seasonId: season.id, status: "ordered", actualPriceCents: 12000, store: "Secret Jeweler", returnBy: addDays(today, 3) })).body;
    const momIdea = (await mk(dad, { title: "Spa day", recipientId: mom.personId })).body;
    const momPast = (await mk(dad, { title: "Old scarf", recipientId: mom.personId, seasonId: past.id, status: "given" })).body;

    // Mom can't see hidden gifts anywhere.
    const momList = (await call("/gifts", { cookie: mom.cookie })).body as any[];
    const momIds = momList.map((g) => g.id);
    expect(momIds).not.toContain(momGift.id);
    expect(momIds).not.toContain(momIdea.id);
    expect(momIds).toContain(momPast.id);
    expect((await call(`/gifts?q=necklace`, { cookie: mom.cookie })).body).toEqual([]);
    expect((await call(`/gifts?seasonId=none`, { cookie: mom.cookie })).body.map((g: any) => g.id)).not.toContain(momIdea.id);
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const r = await call(`/gifts/${momGift.id}`, { method, cookie: mom.cookie, body: method === "PATCH" ? { title: "x" } : undefined });
      expect(r.status, method).toBe(404);
      expect(r.body).toEqual({ error: expect.any(String) });
    }
    // /stores is unaffected.
    expect((await call("/stores", { cookie: mom.cookie })).body).toContain("Secret Jeweler");

    // Dad sees them all.
    const dadList = (await call(`/gifts?seasonId=${season.id}`, { cookie: dad.cookie })).body as any[];
    expect(dadList.map((g) => g.id)).toContain(momGift.id);
    expect((await call(`/gifts/${momGift.id}`, { cookie: dad.cookie })).status).toBe(200);

    // Filters.
    expect((await call(`/gifts?seasonId=${season.id}&status=planned,ordered&recipientId=${kid.id}`, { cookie: dad.cookie })).body.map((g: any) => g.title).sort()).toEqual(["Bike", "Lego"]);
    expect((await call(`/gifts?giverId=${mom.personId}`, { cookie: dad.cookie })).body.map((g: any) => g.title)).toEqual(["Lego"]);
    expect((await call(`/gifts?store=target`, { cookie: dad.cookie })).body.map((g: any) => g.title)).toEqual(["Lego"]);
    expect((await call(`/gifts?category=stocking&seasonId=${season.id}`, { cookie: dad.cookie })).body.map((g: any) => g.title)).toEqual(["Socks"]);
    expect((await call(`/gifts?status=bogus`, { cookie: dad.cookie })).status).toBe(400);

    // Dashboard as Mom: her card is hidden and zeroed; totals leave out her gifts.
    const dm = (await call("/dashboard", { cookie: mom.cookie })).body;
    expect(dm.season.id).toBe(season.id);
    const spent = 8500 + 500; // Bike (actual) + Socks (est)
    const committed = 4000;
    expect(dm.totals).toEqual({ budgetCents: 100000, spentCents: spent, committedCents: committed, remainingCents: 100000 - spent - committed, giftCount: 3, allocatedCents: 50000, unallocatedCents: 50000 });
    const momCard = dm.people.find((p: any) => p.personId === mom.personId);
    expect(momCard).toMatchObject({ hidden: true, budgetCents: 0, stockingBudgetCents: 0, spentCents: 0, committedCents: 0, giftCount: 0, stockingCount: 0 });
    expect(Object.values(momCard.countsByStatus).every((n) => n === 0)).toBe(true);
    const kidCard = dm.people.find((p: any) => p.personId === kid.id);
    expect(kidCard).toMatchObject({ hidden: false, budgetCents: 30000, stockingBudgetCents: 5000, spentCents: spent, committedCents: committed, giftCount: 3, stockingCount: 1 });
    expect(kidCard.countsByStatus).toEqual({ idea: 1, planned: 1, ordered: 1, received: 1, wrapped: 0, given: 0, returned: 0 });
    expect(dm.fairness).toEqual([{ personId: kid.id, spentCents: spent, committedCents: committed, giftCount: 3 }]);
    expect(dm.attention.returnsSoon).toEqual([{ giftId: ordered.id, title: "Bike", recipientId: kid.id, returnBy: addDays(today, -1), level: "red" }]);
    expect(dm.attention.orderedNotReceived.map((g: any) => g.title)).toEqual(["Bike"]);
    expect(dm.attention.receivedNotWrapped.map((g: any) => g.title)).toEqual(["Socks"]);

    // Dashboard as Dad includes Mom's gift.
    const dd = (await call(`/dashboard?seasonId=${season.id}`, { cookie: dad.cookie })).body;
    expect(dd.totals.spentCents).toBe(spent + 12000);
    expect(dd.people.find((p: any) => p.personId === mom.personId)).toMatchObject({ hidden: false, budgetCents: 20000, spentCents: 12000 });
    expect(dd.attention.returnsSoon.map((r: any) => [r.title, r.level])).toEqual([["Bike", "red"], ["Necklace", "amber"]]);

    // Creating a gift for yourself is allowed; it's hidden right away.
    const self = await mk(mom, { title: "Thing I want", recipientId: mom.personId, seasonId: season.id });
    expect(self.status).toBe(201);
    expect((await call(`/gifts/${self.body.id}`, { cookie: mom.cookie })).status).toBe(404);

    // Archiving the season lifts the rule.
    await call(`/seasons/${season.id}`, { method: "PATCH", cookie: dad.cookie, body: { archived: true } });
    expect((await call(`/gifts/${momGift.id}`, { cookie: mom.cookie })).status).toBe(200);
    const dm2 = (await call("/dashboard", { cookie: mom.cookie })).body;
    expect(dm2.people.find((p: any) => p.personId === mom.personId).hidden).toBe(false);
  });

  it("patches, replaces givers, deletes, and logs activity", async () => {
    const dad = await makeUser("Dad");
    const kid = (await call("/people", { method: "POST", cookie: dad.cookie, body: { name: "Sam", kind: "kid" } })).body;
    const santa = ((await call("/people", { cookie: dad.cookie })).body as any[]).find((p) => p.name === "Santa");
    expect(santa).toMatchObject({ kind: "other", emoji: "🎅" });
    const g = (await call("/gifts", { method: "POST", cookie: dad.cookie, body: { title: "Ball", recipientId: kid.id, giverIds: [dad.personId] } })).body;
    const p = await call(`/gifts/${g.id}`, { method: "PATCH", cookie: dad.cookie, body: { status: "ordered", giverIds: [santa.id], actualPriceCents: 1234 } });
    expect(p.body).toMatchObject({ status: "ordered", giverIds: [santa.id], actualPriceCents: 1234, title: "Ball" });
    expect((await call(`/gifts/${g.id}`, { method: "PATCH", cookie: dad.cookie, body: { recipientId: 999999 } })).status).toBe(400);
    expect((await call(`/gifts/${g.id}`, { method: "DELETE", cookie: dad.cookie })).body).toEqual({ ok: true });
    expect((await call(`/gifts/${g.id}`, { cookie: dad.cookie })).status).toBe(404);
    const log = await env.DB.prepare("SELECT action FROM activity_log WHERE gift_id = ? ORDER BY id").bind(g.id).all<{ action: string }>();
    expect(log.results.map((r) => r.action)).toEqual(["create", "update", "delete"]);

    // People delete: linked person -> 409; person with gifts -> archived; otherwise deleted.
    expect((await call(`/people/${dad.personId}`, { method: "DELETE", cookie: dad.cookie })).status).toBe(409);
    expect((await call(`/people/${kid.id}`, { method: "DELETE", cookie: dad.cookie })).body).toEqual({ ok: true, archived: false });
    const kid2 = (await call("/people", { method: "POST", cookie: dad.cookie, body: { name: "Ava", kind: "kid" } })).body;
    await call("/gifts", { method: "POST", cookie: dad.cookie, body: { title: "Book", recipientId: kid2.id } });
    expect((await call(`/people/${kid2.id}`, { method: "DELETE", cookie: dad.cookie })).body).toEqual({ ok: true, archived: true });
    const visible = (await call("/people", { cookie: dad.cookie })).body.map((x: any) => x.id);
    expect(visible).not.toContain(kid2.id);
    expect((await call("/people?includeArchived=1", { cookie: dad.cookie })).body.map((x: any) => x.id)).toContain(kid2.id);
  });

  it("keeps only one active season", async () => {
    const dad = await makeUser("Dad");
    const a = (await call("/seasons", { method: "POST", cookie: dad.cookie, body: { name: "A", date: "2030-12-25", isActive: true } })).body;
    const b = (await call("/seasons", { method: "POST", cookie: dad.cookie, body: { name: "B", date: "2031-12-25", isActive: true } })).body;
    const list = (await call("/seasons", { cookie: dad.cookie })).body as any[];
    expect(list.filter((s) => s.isActive).map((s) => s.id)).toEqual([b.id]);
    await call(`/seasons/${a.id}`, { method: "PATCH", cookie: dad.cookie, body: { isActive: true } });
    const list2 = (await call("/seasons", { cookie: dad.cookie })).body as any[];
    expect(list2.filter((s) => s.isActive).map((s) => s.id)).toEqual([a.id]);
    expect(list2[0].date >= list2[1].date).toBe(true);
  });
});
