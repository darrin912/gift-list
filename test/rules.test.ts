import { describe, expect, it } from "vitest";
import {
  addDays,
  effectivePriceCents,
  isGiftHidden,
  remainingCents,
  returnByLevel,
  sumMoney,
  todayUtc,
} from "../src/worker/rules";

describe("money rules", () => {
  it("effective price prefers actual, then estimate, then 0", () => {
    expect(effectivePriceCents({ actualPriceCents: 1500, estPriceCents: 2000 })).toBe(1500);
    expect(effectivePriceCents({ actualPriceCents: 0, estPriceCents: 2000 })).toBe(0);
    expect(effectivePriceCents({ actualPriceCents: null, estPriceCents: 2000 })).toBe(2000);
    expect(effectivePriceCents({ actualPriceCents: null, estPriceCents: null })).toBe(0);
  });

  it("spent / committed / neither by status", () => {
    const g = (status: any, est: number) => ({ status, estPriceCents: est, actualPriceCents: null });
    const t = sumMoney([
      g("idea", 1),
      g("planned", 10),
      g("ordered", 100),
      g("received", 1000),
      g("wrapped", 10000),
      g("given", 100000),
      g("returned", 1000000),
    ]);
    expect(t).toEqual({ spentCents: 111100, committedCents: 10, giftCount: 5 });
    expect(remainingCents(200000, t)).toBe(200000 - 111100 - 10);
    expect(remainingCents(0, t)).toBeLessThan(0);
  });

  it("return-by warning levels", () => {
    const today = "2026-12-10";
    const g = (status: any, returnBy: string | null) => ({ status, returnBy });
    expect(returnByLevel(g("ordered", "2026-12-09"), today)).toBe("red");
    expect(returnByLevel(g("received", "2026-12-10"), today)).toBe("amber");
    expect(returnByLevel(g("wrapped", "2026-12-17"), today)).toBe("amber");
    expect(returnByLevel(g("wrapped", "2026-12-18"), today)).toBeNull();
    expect(returnByLevel(g("given", "2026-12-01"), today)).toBeNull();
    expect(returnByLevel(g("planned", "2026-12-01"), today)).toBeNull();
    expect(returnByLevel(g("ordered", null), today)).toBeNull();
  });

  it("date helpers", () => {
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(todayUtc(new Date("2026-11-15T23:59:59Z"))).toBe("2026-11-15");
  });
});

describe("surprise rule", () => {
  const today = "2026-12-01";
  const me = 7;
  const gift = { recipientId: me };
  it("hides my gifts in a current or future, non-archived season", () => {
    expect(isGiftHidden(gift, { date: "2026-12-25", archived: false }, me, today)).toBe(true);
    expect(isGiftHidden(gift, { date: today, archived: false }, me, today)).toBe(true);
  });
  it("reveals my gifts once the season is past or archived", () => {
    expect(isGiftHidden(gift, { date: "2026-11-30", archived: false }, me, today)).toBe(false);
    expect(isGiftHidden(gift, { date: "2026-12-25", archived: true }, me, today)).toBe(false);
  });
  it("always hides my ideas-inbox gifts", () => {
    expect(isGiftHidden(gift, null, me, today)).toBe(true);
  });
  it("never hides other people's gifts, or anything from a user with no person", () => {
    expect(isGiftHidden({ recipientId: 8 }, { date: "2026-12-25", archived: false }, me, today)).toBe(false);
    expect(isGiftHidden({ recipientId: 8 }, null, me, today)).toBe(false);
    expect(isGiftHidden(gift, null, null, today)).toBe(false);
  });
});
