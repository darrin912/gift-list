import { describe, expect, it } from "vitest";
import type { Gift, Person } from "../api";
import { giftQueryString, similarQueryString } from "../api";
import { buildGiversMatrix, cellKey, emptyCellCount, groupByRecipient, groupByStore } from "./lists";
import { allocation } from "./format";
import { pairHasGift } from "./phase3";
import {
  csvRecipientLabel,
  forFromParams,
  forQuery,
  forStateError,
  giftRecipientIds,
  matchesRecipientFilter,
  recipientFilterValue,
  recipientLabel,
  shareFor,
  splitHint,
  splitShares,
  toggleFamily,
  toggleRecipient,
} from "./recipients";

const P = (id: number, name: string, kind: Person["kind"], extra: Partial<Person> = {}): Person => ({
  id,
  name,
  kind,
  color: null,
  emoji: null,
  birthday: null,
  sizes: {},
  likes: null,
  dislikes: null,
  notes: null,
  sortOrder: id,
  archived: false,
  ...extra,
});

let nid = 1;
const G = (extra: Partial<Gift>): Gift => ({
  id: nid++,
  seasonId: 1,
  recipientIds: [4],
  isFamily: false,
  title: "Gift",
  description: null,
  url: null,
  imageUrl: null,
  category: "main",
  status: "planned",
  wished: false,
  priority: 2,
  estPriceCents: null,
  actualPriceCents: null,
  store: null,
  orderNumber: null,
  trackingUrl: null,
  returnBy: null,
  giverIds: [],
  createdBy: 1,
  updatedBy: 1,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  ...extra,
});

const people = [P(1, "Mom", "parent"), P(2, "Dad", "parent"), P(4, "Ava", "kid", { emoji: "🦄" }), P(5, "Ben", "kid"), P(6, "Cal", "kid")];
const map = new Map(people.map((p) => [p.id, p]));

describe("recipient labels", () => {
  it("joins names in people order and shows family", () => {
    expect(recipientLabel(G({ recipientIds: [4] }), map)).toBe("Ava");
    expect(recipientLabel(G({ recipientIds: [4] }), map, { emoji: true })).toBe("🦄 Ava");
    expect(recipientLabel(G({ recipientIds: [5, 4] }), map)).toBe("Ava & Ben");
    expect(recipientLabel(G({ recipientIds: [5, 4] }), map, { emoji: true })).toBe("Ava & Ben");
    expect(recipientLabel(G({ recipientIds: [6, 4, 5] }), map)).toBe("Ava, Ben & Cal");
    expect(recipientLabel(G({ recipientIds: [], isFamily: true }), map)).toBe("🏠 Family");
    expect(recipientLabel(G({ recipientIds: [], isFamily: true }), map, { family: "the family" })).toBe("the family");
    expect(recipientLabel(G({ recipientIds: [99] }), map)).toBe("Unknown");
  });

  it("accepts the old single recipientId shape", () => {
    expect(giftRecipientIds({ recipientId: 5 })).toEqual([5]);
    expect(giftRecipientIds({ recipientIds: [4, 5], recipientId: 9 })).toEqual([4, 5]);
    expect(giftRecipientIds({ isFamily: true, recipientId: 4 })).toEqual([]);
    expect(recipientLabel({ recipientId: 5 }, map)).toBe("Ben");
  });

  it("shows Family in the CSV preview", () => {
    expect(csvRecipientLabel("family")).toBe("🏠 Family");
    expect(csvRecipientLabel("FAMILY ")).toBe("🏠 Family");
    expect(csvRecipientLabel("Ava & Ben")).toBe("Ava & Ben");
  });
});

describe("money split", () => {
  it("floors each share and gives the remainder to ascending person ids", () => {
    expect([...splitShares(30000, [5, 4])]).toEqual([
      [4, 15000],
      [5, 15000],
    ]);
    const s = splitShares(10000, [6, 4, 5]);
    expect(s.get(4)).toBe(3334);
    expect(s.get(5)).toBe(3333);
    expect(s.get(6)).toBe(3333);
    const t = splitShares(10001, [9, 2, 5]);
    expect([t.get(2), t.get(5), t.get(9)]).toEqual([3334, 3334, 3333]);
    expect([...t.values()].reduce((a, b) => a + b, 0)).toBe(10001);
    expect(splitShares(500, []).size).toBe(0);
  });

  it("gives one person's share and nothing for family gifts", () => {
    expect(shareFor(10000, G({ recipientIds: [6, 4, 5] }), 4)).toBe(3334);
    expect(shareFor(10000, G({ recipientIds: [6, 4, 5] }), 6)).toBe(3333);
    expect(shareFor(10000, G({ recipientIds: [4] }), 4)).toBe(10000);
    expect(shareFor(10000, G({ recipientIds: [], isFamily: true }), 4)).toBe(0);
  });

  it("formats the split hint", () => {
    expect(splitHint(30000, [4, 5])).toBe("$150 each");
    expect(splitHint(10000, [4, 5, 6])).toBe("$33.33–$33.34 each");
    expect(splitHint(30000, [4])).toBeNull();
    expect(splitHint(null, [4, 5])).toBeNull();
    expect(splitHint(0, [4, 5])).toBeNull();
  });

  it("counts the family budget in the allocation", () => {
    expect(allocation(100000, [30000, 30000, 25000]).unallocatedCents).toBe(15000);
  });
});

describe("gift form For state", () => {
  it("makes Whole family exclusive with people", () => {
    let s = { recipientIds: [] as number[], isFamily: false };
    s = toggleRecipient(s, 4);
    s = toggleRecipient(s, 5);
    expect(s).toEqual({ recipientIds: [4, 5], isFamily: false });
    s = toggleFamily(s);
    expect(s).toEqual({ recipientIds: [], isFamily: true });
    s = toggleRecipient(s, 6);
    expect(s).toEqual({ recipientIds: [6], isFamily: false });
    s = toggleRecipient(s, 6);
    expect(s).toEqual({ recipientIds: [], isFamily: false });
    expect(toggleFamily(toggleFamily(s))).toEqual({ recipientIds: [], isFamily: false });
  });

  it("validates like the server", () => {
    expect(forStateError({ recipientIds: [], isFamily: false })).toMatch(/Choose/);
    expect(forStateError({ recipientIds: [4], isFamily: false })).toBeNull();
    expect(forStateError({ recipientIds: [], isFamily: true })).toBeNull();
    expect(forStateError({ recipientIds: [4], isFamily: true })).toMatch(/family/);
    expect(forStateError({ recipientIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], isFamily: false })).toMatch(/10/);
  });

  it("prefills from new and old query params", () => {
    expect(forFromParams(new URLSearchParams("recipientIds=4,5"))).toEqual({ recipientIds: [4, 5], isFamily: false });
    expect(forFromParams(new URLSearchParams("recipient=6&from=4"))).toEqual({ recipientIds: [6], isFamily: false });
    expect(forFromParams(new URLSearchParams("recipientId=6"))).toEqual({ recipientIds: [6], isFamily: false });
    expect(forFromParams(new URLSearchParams("family=1"))).toEqual({ recipientIds: [], isFamily: true });
    expect(forFromParams(new URLSearchParams("recipient=family"))).toEqual({ recipientIds: [], isFamily: true });
    expect(forFromParams(new URLSearchParams("recipientIds=x,0,-1"))).toEqual({ recipientIds: [], isFamily: false });
    expect(forQuery({ recipientIds: [4, 5], isFamily: false })).toBe("recipientIds=4,5");
    expect(forQuery({ recipientIds: [], isFamily: true })).toBe("family=1");
  });
});

describe("gift list filters", () => {
  it("reads the For filter and passes it to the API", () => {
    expect(recipientFilterValue("family")).toBe("family");
    expect(recipientFilterValue("4")).toBe(4);
    expect(recipientFilterValue("")).toBeUndefined();
    expect(recipientFilterValue("abc")).toBeUndefined();
    expect(giftQueryString({ seasonId: 1, recipientId: "family" })).toBe("?seasonId=1&recipientId=family");
    expect(giftQueryString({ recipientId: 5 })).toBe("?recipientId=5");
  });

  it("matches any recipient, and family only for family gifts", () => {
    const shared = G({ recipientIds: [4, 5] });
    const fam = G({ recipientIds: [], isFamily: true });
    expect(matchesRecipientFilter(shared, 5)).toBe(true);
    expect(matchesRecipientFilter(shared, 4)).toBe(true);
    expect(matchesRecipientFilter(shared, 6)).toBe(false);
    expect(matchesRecipientFilter(shared, "family")).toBe(false);
    expect(matchesRecipientFilter(fam, "family")).toBe(true);
    expect(matchesRecipientFilter(fam, 4)).toBe(false);
    expect(matchesRecipientFilter(fam, undefined)).toBe(true);
  });

  it("builds the similar-gifts query with every recipient", () => {
    expect(new URLSearchParams(similarQueryString({ recipientIds: [1, 2], title: "Lego" })).get("recipientIds")).toBe("1,2");
  });
});

describe("lists with shared and family gifts", () => {
  it("fills every recipient's column in the givers matrix", () => {
    const tramp = G({ title: "Trampoline", recipientIds: [1, 2, 5], giverIds: [4, 5] });
    const fam = G({ title: "Board game", recipientIds: [], isFamily: true, giverIds: [4] });
    const m = buildGiversMatrix([tramp, fam], people);
    expect(m.cells.get(cellKey(4, 1))).toEqual([tramp]);
    expect(m.cells.get(cellKey(4, 2))).toEqual([tramp]);
    expect(m.cells.get(cellKey(4, 5))).toEqual([tramp]);
    expect(m.cells.get(cellKey(5, 1))).toEqual([tramp]);
    expect(m.cells.get(cellKey(5, 2))).toEqual([tramp]);
    // Never on the diagonal (Ben to Ben), and family gifts fill no column.
    expect(m.cells.has(cellKey(5, 5))).toBe(false);
    expect([...m.cells.values()].flat().includes(fam)).toBe(false);
    // Givers Ava, Ben, Cal × 4 others each = 12 pairs; 5 covered.
    expect(emptyCellCount(m)).toBe(7);
  });

  it("lists a shared gift once and puts family gifts in a final group", () => {
    const a = G({ title: "Kite", recipientIds: [5] });
    const shared = G({ title: "Trampoline", recipientIds: [5, 4] });
    const fam = G({ title: "Board game", recipientIds: [], isFamily: true });
    const groups = groupByRecipient([fam, shared, a], [1, 2, 4, 5, 6]);
    expect(groups.map((g) => g.recipientId)).toEqual([4, 5, "family"]);
    expect(groups[0].gifts).toEqual([shared]);
    expect(groups[1].gifts).toEqual([a]);
    expect(groups[2].gifts).toEqual([fam]);
    expect(groups.flatMap((g) => g.gifts)).toHaveLength(3);
  });

  it("lists a shared gift once on the shopping list", () => {
    const shared = G({ title: "Trampoline", store: "Target", estPriceCents: 30000, recipientIds: [4, 5] });
    const groups = groupByStore([shared], (g) => recipientLabel(g, map));
    expect(groups[0].gifts).toEqual([shared]);
    expect(groups[0].subtotalCents).toBe(30000);
  });

  it("ticks a name-draw pair when the recipient is one of several", () => {
    expect(pairHasGift({ giverId: 4, recipientId: 5 }, [G({ recipientIds: [1, 5], giverIds: [4] })], 1)).toBe(true);
    expect(pairHasGift({ giverId: 4, recipientId: 5 }, [G({ recipientIds: [], isFamily: true, giverIds: [4] })], 1)).toBe(false);
  });
});
