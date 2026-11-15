import { describe, expect, it, vi } from "vitest";
import { DRAW_FALLBACK_NOTE, drawNames, randomInt, shuffle } from "../src/worker/draw";
import { isPriceDrop, normalizeTitle, titlesSimilar } from "../src/worker/rules";
import { priceDropSummary } from "../src/worker/price-watch";

function checkDerangement(ids: number[], pairs: { giverId: number; recipientId: number }[]) {
  expect(pairs).toHaveLength(ids.length);
  expect(new Set(pairs.map((p) => p.giverId))).toEqual(new Set(ids));
  expect(new Set(pairs.map((p) => p.recipientId))).toEqual(new Set(ids));
  for (const p of pairs) expect(p.recipientId).not.toBe(p.giverId);
}

describe("name draw (derangement)", () => {
  it("never pairs anyone with themselves and assigns everyone exactly once", () => {
    for (let n = 2; n <= 12; n++) {
      const ids = Array.from({ length: n }, (_, i) => 100 + i);
      for (let k = 0; k < 50; k++) checkDerangement(ids, drawNames(ids).pairs);
    }
  });

  it("uses crypto.getRandomValues", () => {
    const spy = vi.spyOn(crypto, "getRandomValues");
    drawNames([1, 2, 3, 4]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("produces varied results (not a fixed rotation)", () => {
    const seen = new Set<string>();
    for (let k = 0; k < 200; k++) seen.add(JSON.stringify(drawNames([1, 2, 3, 4]).pairs));
    expect(seen.size).toBe(9); // all 9 derangements of 4
  });

  it("avoids last season's pairings when possible", () => {
    const ids = [1, 2, 3, 4, 5];
    const previous = [
      { giverId: 1, recipientId: 2 },
      { giverId: 2, recipientId: 3 },
      { giverId: 3, recipientId: 4 },
      { giverId: 4, recipientId: 5 },
      { giverId: 5, recipientId: 1 },
    ];
    for (let k = 0; k < 200; k++) {
      const r = drawNames(ids, previous);
      expect(r.note).toBeUndefined();
      checkDerangement(ids, r.pairs);
      for (const p of r.pairs) expect(previous.some((q) => q.giverId === p.giverId && q.recipientId === p.recipientId)).toBe(false);
    }
    // n = 3 with a previous 3-cycle: the reverse cycle is the only option.
    for (let k = 0; k < 20; k++) {
      const r = drawNames([1, 2, 3], [
        { giverId: 1, recipientId: 2 },
        { giverId: 2, recipientId: 3 },
        { giverId: 3, recipientId: 1 },
      ]);
      expect(r.note).toBeUndefined();
      expect(r.pairs).toEqual([
        { giverId: 1, recipientId: 3 },
        { giverId: 2, recipientId: 1 },
        { giverId: 3, recipientId: 2 },
      ]);
    }
  });

  it("falls back with a note when avoiding is impossible", () => {
    const r = drawNames([1, 2], [
      { giverId: 1, recipientId: 2 },
      { giverId: 2, recipientId: 1 },
    ]);
    expect(r.note).toBe(DRAW_FALLBACK_NOTE);
    expect(r.pairs).toEqual([
      { giverId: 1, recipientId: 2 },
      { giverId: 2, recipientId: 1 },
    ]);
  });

  it("ignores previous pairings of people not in this draw and rejects < 2", () => {
    const r = drawNames([1, 2, 3], [{ giverId: 9, recipientId: 1 }]);
    expect(r.note).toBeUndefined();
    checkDerangement([1, 2, 3], r.pairs);
    expect(() => drawNames([1])).toThrow();
    expect(() => drawNames([1, 1])).toThrow();
  });

  it("randomInt stays in range and shuffle keeps elements", () => {
    for (let i = 0; i < 500; i++) {
      const x = randomInt(7);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(7);
    }
    expect(shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(() => randomInt(0)).toThrow();
  });
});

describe("similar titles", () => {
  it("normalizes case, punctuation and whitespace", () => {
    expect(normalizeTitle("  LEGO®   Set!! ")).toBe("lego set");
    expect(normalizeTitle("Kids' T-Shirt, (Blue)")).toBe("kids tshirt blue");
    expect(normalizeTitle("Café   Crème")).toBe("cafe creme");
  });

  it("matches equal or contained titles of at least 4 characters", () => {
    expect(titlesSimilar("LEGO Set", "lego set!")).toBe(true);
    expect(titlesSimilar("LEGO Star Wars Set", "Star Wars")).toBe(true);
    expect(titlesSimilar("Star Wars", "LEGO Star Wars Set")).toBe(true);
    expect(titlesSimilar("Fuzzy socks", "Puzzle")).toBe(false);
    expect(titlesSimilar("Car", "Race car")).toBe(false); // "car" is under 4 characters
    expect(titlesSimilar("!!!", "!!!")).toBe(false);
  });
});

describe("price drop rule", () => {
  it("needs at least $1 or 5%", () => {
    expect(isPriceDrop(5999, 4499)).toBe(true);
    expect(isPriceDrop(10000, 9900)).toBe(true); // exactly $1
    expect(isPriceDrop(10000, 9901)).toBe(false); // 99¢ and under 5%
    expect(isPriceDrop(500, 475)).toBe(true); // exactly 5%
    expect(isPriceDrop(500, 476)).toBe(false);
    expect(isPriceDrop(5000, 5000)).toBe(false);
    expect(isPriceDrop(5000, 6000)).toBe(false);
    expect(isPriceDrop(null, 100)).toBe(false);
  });

  it("formats the activity summary", () => {
    expect(priceDropSummary("X", 5999, 4499)).toBe('Price dropped on "X": $59.99 → $44.99');
  });
});
