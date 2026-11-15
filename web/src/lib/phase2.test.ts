import { describe, expect, it } from "vitest";
import type { ActivityEntry, Gift, Person } from "../api";
import { activityQueryString, exportCsvUrl } from "../api";
import { ANYWHERE, buildGiversMatrix, cellKey, emptyCellCount, groupByRecipient, groupByStore, looksLikeUrl, mergePreview, sortGifts, sumCents, wrapProgress } from "./lists";
import { csvDataRowCount, orderImportRows, parseImportTarget, summarizeImport } from "./csv";
import { attributeFor, parseThemePref, resolveTheme } from "./theme";
import { allocation, centsToInput, isGiverOnly, recipientsOf } from "./format";
import { groupByDay, timeAgo } from "./activity";

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

let nextId = 1;
const G = (extra: Partial<Gift>): Gift => ({
  id: nextId++,
  seasonId: 1,
  recipientIds: [1],
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

const people = [
  P(1, "Mom", "parent"),
  P(2, "Dad", "parent"),
  P(3, "Santa", "other", { giverOnly: true }),
  P(4, "Emma", "kid"),
  P(5, "Noah", "kid"),
  P(6, "Old kid", "kid", { archived: true }),
];
const names = new Map(people.map((p) => [p.id, p.name]));
const nameOf = (g: Gift) => names.get(g.recipientIds[0]) ?? "";

describe("shopping list grouping", () => {
  it("groups by store case-insensitively with Anywhere last and subtotals", () => {
    const gifts = [
      G({ title: "Socks", store: "Target", estPriceCents: 500, recipientIds: [5] }),
      G({ title: "Book", store: null, estPriceCents: 1200 }),
      G({ title: "Lego", store: " target ", estPriceCents: 4000, actualPriceCents: 3500, recipientIds: [4] }),
      G({ title: "Kite", store: "Amazon", estPriceCents: null }),
      G({ title: "Mug", store: "  ", estPriceCents: 800 }),
    ];
    const groups = groupByStore(gifts, nameOf);
    expect(groups.map((g) => g.store)).toEqual(["Target", "Amazon", ANYWHERE]);
    expect(groups[0].subtotalCents).toBe(4000);
    expect(groups[0].gifts.map((g) => g.title)).toEqual(["Lego", "Socks"]); // Emma before Noah
    expect(groups[2].gifts).toHaveLength(2);
    expect(groups[2].subtotalCents).toBe(2000);
    expect(sumCents(gifts)).toBe(3500 + 500 + 1200 + 800);
  });

  it("returns no groups for no gifts", () => {
    expect(groupByStore([])).toEqual([]);
  });
});

describe("wrapping", () => {
  it("counts progress and groups by recipient in people order", () => {
    const gifts = [
      G({ status: "received", recipientIds: [5] }),
      G({ status: "wrapped", recipientIds: [5], title: "B" }),
      G({ status: "given", recipientIds: [4], title: "A" }),
      G({ status: "planned", recipientIds: [4] }),
    ];
    expect(wrapProgress(gifts)).toEqual({ toWrap: 1, wrapped: 1, given: 1, here: 3 });
    expect(groupByRecipient(gifts, [4, 5]).map((g) => g.recipientId)).toEqual([4, 5]);
  });
});

describe("givers matrix", () => {
  it("uses kids as givers and parents + kids as columns, skipping giver-only and archived people", () => {
    const m = buildGiversMatrix([], people);
    expect(m.givers.map((p) => p.name)).toEqual(["Emma", "Noah"]);
    expect(m.recipients.map((p) => p.name)).toEqual(["Mom", "Dad", "Emma", "Noah"]);
  });

  it("puts a gift in every giver row it lists, never on the diagonal, ignoring returned gifts", () => {
    const shared = G({ title: "Mug", recipientIds: [1], giverIds: [4, 5] });
    const gifts = [
      shared,
      G({ title: "Card", recipientIds: [2], giverIds: [4] }),
      G({ title: "Self", recipientIds: [4], giverIds: [4] }),
      G({ title: "Returned", recipientIds: [5], giverIds: [4], status: "returned" }),
      G({ title: "From Santa", recipientIds: [5], giverIds: [3] }),
      G({ title: "To Santa?", recipientIds: [3], giverIds: [4] }),
    ];
    const m = buildGiversMatrix(gifts, people);
    expect(m.cells.get(cellKey(4, 1))).toEqual([shared]);
    expect(m.cells.get(cellKey(5, 1))).toEqual([shared]);
    expect(m.cells.get(cellKey(4, 2))?.map((g) => g.title)).toEqual(["Card"]);
    expect(m.cells.has(cellKey(4, 4))).toBe(false);
    expect(m.cells.has(cellKey(4, 5))).toBe(false);
    expect([...m.cells.keys()].some((k) => k.endsWith(":3"))).toBe(false);
    // 2 givers × 3 others = 6 pairs; Emma→Mom, Noah→Mom, Emma→Dad are covered.
    expect(emptyCellCount(m)).toBe(3);
    // The viewer's own column (Dad = 2) is skipped since their gifts are hidden.
    expect(emptyCellCount(m, 2)).toBe(2);
  });
});

describe("gifts table sort", () => {
  const a = G({ title: "banana", recipientIds: [5], status: "wrapped", estPriceCents: 300, store: "Zed" });
  const b = G({ title: "Apple", recipientIds: [4], status: "idea", estPriceCents: 900, store: "" });
  const c = G({ title: "cherry", recipientIds: [1], status: "ordered", actualPriceCents: 100, store: "amazon" });
  const list = [a, b, c];
  it("sorts by each column, both directions", () => {
    expect(sortGifts(list, "title", "asc", nameOf)).toEqual([b, a, c]);
    expect(sortGifts(list, "recipient", "asc", nameOf)).toEqual([b, c, a]);
    expect(sortGifts(list, "status", "asc", nameOf)).toEqual([b, c, a]);
    expect(sortGifts(list, "price", "desc", nameOf)).toEqual([b, a, c]);
  });
  it("keeps gifts with no store last in both directions", () => {
    expect(sortGifts(list, "store", "asc", nameOf)).toEqual([c, a, b]);
    expect(sortGifts(list, "store", "desc", nameOf)).toEqual([a, c, b]);
  });
});

describe("link preview merge", () => {
  const form = { title: "", imageUrl: "", est: "", store: "Target", other: 1 };
  it("fills only empty fields", () => {
    const { next, filled } = mergePreview(form, { title: " Kite ", imageUrl: "https://example.com/k.jpg", priceCents: 1999, store: "Amazon" }, centsToInput);
    expect(next).toEqual({ title: "Kite", imageUrl: "https://example.com/k.jpg", est: "19.99", store: "Target", other: 1 });
    expect(filled).toEqual(["title", "imageUrl", "est"]);
  });
  it("fills nothing from an empty or blocked preview", () => {
    const { next, filled } = mergePreview(form, { title: "", imageUrl: "", priceCents: null, store: "", blocked: true }, centsToInput);
    expect(next).toEqual(form);
    expect(filled).toEqual([]);
  });
  it("recognises pasted links", () => {
    expect(looksLikeUrl(" https://example.com/item?id=1 ")).toBe(true);
    expect(looksLikeUrl("example.com")).toBe(false);
    expect(looksLikeUrl("see https://example.com")).toBe(false);
    expect(looksLikeUrl("ftp://example.com")).toBe(false);
  });
});

describe("csv helpers", () => {
  it("counts data rows with quoted commas, quotes and newlines", () => {
    expect(csvDataRowCount("")).toBe(0);
    expect(csvDataRowCount("title,recipient\n")).toBe(0);
    expect(csvDataRowCount("title,recipient\nA,Emma\nB,Noah")).toBe(2);
    expect(csvDataRowCount('﻿title,recipient,description\r\n"Lego, big",Emma,"line 1\nline 2"\r\n\r\n"Say ""hi""",Noah,x\r\n')).toBe(2);
  });
  it("summarizes and orders dry-run rows", () => {
    const rows = [
      { line: 2, ok: true, title: "A" },
      { line: 3, ok: false, error: "Unknown recipient" },
      { line: 4, ok: true },
      { line: 1, ok: false },
    ];
    expect(summarizeImport(rows)).toEqual({ total: 4, ok: 2, errors: 2 });
    expect(orderImportRows(rows).map((r) => r.line)).toEqual([1, 3, 2, 4]);
  });
  it("parses the import target and builds API URLs", () => {
    expect(parseImportTarget("inbox")).toBeNull();
    expect(parseImportTarget("7")).toBe(7);
    expect(exportCsvUrl()).toBe("/api/export.csv");
    expect(exportCsvUrl(3)).toBe("/api/export.csv?seasonId=3");
    expect(activityQueryString({})).toBe("");
    expect(activityQueryString({ limit: 5, seasonId: 2 })).toBe("?limit=5&seasonId=2");
  });
});

describe("theme", () => {
  it("resolves preferences against the OS setting", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("holiday", true)).toBe("holiday");
  });
  it("maps preferences to the data-theme attribute", () => {
    expect(attributeFor("system")).toBeNull();
    expect(attributeFor("dark")).toBe("dark");
    expect(attributeFor("holiday")).toBe("holiday");
  });
  it("parses stored values defensively", () => {
    expect(parseThemePref("holiday")).toBe("holiday");
    expect(parseThemePref("neon")).toBe("system");
    expect(parseThemePref(null)).toBe("system");
  });
});

describe("giver-only and allocation", () => {
  it("treats missing giverOnly as false", () => {
    expect(isGiverOnly(P(9, "X", "kid"))).toBe(false);
    expect(recipientsOf(people).map((p) => p.name)).toEqual(["Mom", "Dad", "Emma", "Noah"]);
  });
  it("computes allocation and over-allocation", () => {
    expect(allocation(100000, [30000, 20000])).toEqual({ allocatedCents: 50000, unallocatedCents: 50000, overCents: 0 });
    expect(allocation(40000, [30000, 20000])).toEqual({ allocatedCents: 50000, unallocatedCents: -10000, overCents: 10000 });
  });
});

describe("activity", () => {
  const now = new Date(2026, 10, 15, 12, 0, 0);
  const at = (d: Date) => d.toISOString();
  it("phrases relative times", () => {
    expect(timeAgo(at(new Date(2026, 10, 15, 11, 59, 40)), now)).toBe("just now");
    expect(timeAgo(at(new Date(2026, 10, 15, 11, 35)), now)).toBe("25 min ago");
    expect(timeAgo(at(new Date(2026, 10, 15, 9, 0)), now)).toBe("3 h ago");
    expect(timeAgo(at(new Date(2026, 10, 14, 20, 0)), now)).toBe("Yesterday");
    expect(timeAgo(at(new Date(2026, 10, 2, 20, 0)), now)).toBe("Nov 2");
  });
  it("groups entries by local day", () => {
    const e = (id: number, d: Date): ActivityEntry => ({ id, userId: 1, userName: "Mom", action: "created", summary: "x", giftId: null, recipientId: null, seasonId: null, at: at(d) });
    const groups = groupByDay([e(1, new Date(2026, 10, 15, 9)), e(2, new Date(2026, 10, 15, 8)), e(3, new Date(2026, 10, 13, 8))]);
    expect(groups.map((g) => g.entries.map((x) => x.id))).toEqual([[1, 2], [3]]);
  });
});
