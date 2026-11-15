import { describe, expect, it } from "vitest";
import {
  addDays,
  effectivePriceCents,
  isGiftHidden,
  splitCents,
  sumMoneyFor,
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
  const gift = { recipientIds: [me], isFamily: false };
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
    const other = { recipientIds: [8], isFamily: false };
    expect(isGiftHidden(other, { date: "2026-12-25", archived: false }, me, today)).toBe(false);
    expect(isGiftHidden(other, null, me, today)).toBe(false);
    expect(isGiftHidden(gift, null, null, today)).toBe(false);
  });
  it("hides a shared gift when I'm one of its recipients", () => {
    const shared = { recipientIds: [3, me, 9], isFamily: false };
    expect(isGiftHidden(shared, { date: "2026-12-25", archived: false }, me, today)).toBe(true);
    expect(isGiftHidden(shared, { date: "2026-12-25", archived: false }, 3, today)).toBe(true);
    expect(isGiftHidden(shared, { date: "2026-12-25", archived: false }, 4, today)).toBe(false);
    expect(isGiftHidden(shared, { date: "2026-11-30", archived: false }, me, today)).toBe(false);
  });
  it("never hides family gifts", () => {
    const family = { recipientIds: [], isFamily: true };
    expect(isGiftHidden(family, { date: "2026-12-25", archived: false }, me, today)).toBe(false);
    expect(isGiftHidden(family, null, me, today)).toBe(false);
  });
});

describe("splitCents / sumMoneyFor", () => {
  it("splits evenly, remainder cents to ascending person ids", () => {
    expect([...splitCents(1000, [3, 1, 2])].sort((a, b) => a[0] - b[0])).toEqual([[1, 334], [2, 333], [3, 333]]);
    expect([...splitCents(1001, [9, 4, 6])].sort((a, b) => a[0] - b[0])).toEqual([[4, 334], [6, 334], [9, 333]]);
    expect([...splitCents(5, [2, 1])].sort((a, b) => a[0] - b[0])).toEqual([[1, 3], [2, 2]]);
    expect([...splitCents(0, [1, 2])].map(([, v]) => v)).toEqual([0, 0]);
    expect(splitCents(100, []).size).toBe(0);
    expect(splitCents(700, [5]).get(5)).toBe(700);
  });
  it("shares always add up to the price", () => {
    for (const price of [1, 2, 7, 99, 1000, 12345, 99999]) {
      for (let n = 1; n <= 10; n++) {
        const ids = Array.from({ length: n }, (_, i) => 100 - i * 7);
        const shares = [...splitCents(price, ids).values()];
        expect(shares.reduce((a, b) => a + b, 0)).toBe(price);
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
      }
    }
  });
  it("sums one person's shares and counts each gift once per recipient", () => {
    const gifts = [
      { status: "ordered" as const, estPriceCents: 1000, actualPriceCents: null, recipientIds: [1, 2, 3] },
      { status: "planned" as const, estPriceCents: 501, actualPriceCents: null, recipientIds: [2, 3] },
      { status: "idea" as const, estPriceCents: 900, actualPriceCents: null, recipientIds: [1] },
      { status: "given" as const, estPriceCents: null, actualPriceCents: 200, recipientIds: [4] },
    ];
    expect(sumMoneyFor(gifts, 1)).toEqual({ spentCents: 334, committedCents: 0, giftCount: 1 });
    expect(sumMoneyFor(gifts, 2)).toEqual({ spentCents: 333, committedCents: 251, giftCount: 2 });
    expect(sumMoneyFor(gifts, 3)).toEqual({ spentCents: 333, committedCents: 250, giftCount: 2 });
    expect(sumMoneyFor(gifts, 4)).toEqual({ spentCents: 200, committedCents: 0, giftCount: 1 });
  });
});
