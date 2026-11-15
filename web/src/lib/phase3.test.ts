import { describe, expect, it } from "vitest";
import type { Gift, Person, Season, SimilarGift } from "../api";
import { ApiError, similarQueryString, toDrawResult } from "../api";
import { escapeHtml, renderMarkdown, safeHref } from "./markdown";
import {
  activityActor,
  birthdaySeasonName,
  canCheckSimilar,
  defaultDeviceName,
  defaultDrawParticipants,
  drawGiftHref,
  findBirthdaySeason,
  groupHistoryByYear,
  groupSeasons,
  honoreeFirst,
  inDays,
  nextBirthday,
  normalizeTitle,
  pairHasGift,
  passkeyError,
  priceWatchInfo,
  showFairness,
  similarHint,
  similarHintText,
  upcomingBirthdays,
} from "./phase3";

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
const S = (id: number, kind: Season["kind"], extra: Partial<Season> = {}): Season => ({
  id,
  kind,
  name: `Season ${id}`,
  date: "2026-12-25",
  overallBudgetCents: 0,
  isActive: false,
  archived: false,
  ...extra,
});
let nid = 1;
const G = (extra: Partial<Gift>): Gift => ({
  id: nid++,
  seasonId: 1,
  recipientId: 1,
  title: "Gift",
  description: null,
  url: null,
  imageUrl: null,
  category: "main",
  status: "idea",
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
  createdAt: "",
  updatedAt: "",
  ...extra,
});

describe("renderMarkdown (safety)", () => {
  it("escapes script tags and raw HTML", () => {
    const out = renderMarkdown('<script>alert("x")</script>\n<img src=x onerror=alert(1)>');
    expect(out).not.toMatch(/<script|<img/i);
    expect(out).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
  it("drops javascript:, data: and vbscript: links but keeps the text", () => {
    for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "vbscript:msgbox(1)", "//evil.example.com"]) {
      const out = renderMarkdown(`[click](${url})`);
      expect(out).not.toContain("<a");
      expect(out).toContain("click");
    }
  });
  it("can't break out of the href attribute", () => {
    const out = renderMarkdown('[x](https://example.com/"onmouseover="alert(1))');
    expect(out).not.toMatch(/"\s*onmouseover=/);
    const bare = renderMarkdown('see https://example.com/a"b');
    expect(bare).toContain('href="https://example.com/a"');
  });
  it("renders safe links with rel and target", () => {
    expect(renderMarkdown("[Shop](https://example.com/p?a=1&b=2)")).toBe(
      '<p><a href="https://example.com/p?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Shop</a></p>',
    );
    expect(renderMarkdown("[Mail](mailto:mom@example.com)")).toContain('href="mailto:mom@example.com"');
    expect(renderMarkdown("Go to https://example.com/x.")).toBe(
      '<p>Go to <a href="https://example.com/x" target="_blank" rel="noopener noreferrer">https://example.com/x</a>.</p>',
    );
  });
  it("does bold, italics, code, line breaks and lists", () => {
    expect(renderMarkdown("**Size 8** and *blue*\nnext line")).toBe("<p><strong>Size 8</strong> and <em>blue</em><br>next line</p>");
    expect(renderMarkdown("- one\n- two\n\n1. a\n2. b")).toBe("<ul><li>one</li><li>two</li></ul><ol><li>a</li><li>b</li></ol>");
    expect(renderMarkdown("`<b>`")).toBe("<p><code>&lt;b&gt;</code></p>");
    expect(renderMarkdown("snake_case_name stays")).toBe("<p>snake_case_name stays</p>");
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(null)).toBe("");
  });
  it("safeHref and escapeHtml", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("http://")).toBeNull();
    expect(safeHref("https://exa mple.com")).toBeNull();
    expect(safeHref("ftp://example.com")).toBeNull();
    expect(escapeHtml(`<a href='x'>&`)).toBe("&lt;a href=&#39;x&#39;&gt;&amp;");
  });
});

describe("nextBirthday", () => {
  it("finds this year's or next year's birthday", () => {
    expect(nextBirthday("2018-12-01", "2026-11-15")).toEqual({ date: "2026-12-01", days: 16, turning: 8 });
    expect(nextBirthday("2018-03-10", "2026-11-15")).toEqual({ date: "2027-03-10", days: 115, turning: 9 });
    expect(nextBirthday("2018-11-15", "2026-11-15")).toEqual({ date: "2026-11-15", days: 0, turning: 8 });
  });
  it("handles Feb 29 in common and leap years", () => {
    expect(nextBirthday("2016-02-29", "2026-11-15")?.date).toBe("2027-02-28");
    expect(nextBirthday("2016-02-29", "2027-11-15")?.date).toBe("2028-02-29");
    expect(nextBirthday("2016-02-29", "2027-02-28")).toMatchObject({ date: "2027-02-28", days: 0 });
    expect(nextBirthday("2016-02-29", "2100-01-01")?.date).toBe("2100-02-28"); // 2100 isn't a leap year
  });
  it("returns null for missing or bad dates", () => {
    expect(nextBirthday(null)).toBeNull();
    expect(nextBirthday("12/01")).toBeNull();
    expect(nextBirthday("2018-13-01")).toBeNull();
  });
  it("builds names, phrases and the upcoming list", () => {
    expect(birthdaySeasonName("Ava", "2027-03-10")).toBe("Ava's Birthday 2027");
    expect(birthdaySeasonName("James", "2027-03-10")).toBe("James' Birthday 2027");
    expect([inDays(0), inDays(1), inDays(9)]).toEqual(["today", "tomorrow", "in 9 days"]);
    const people = [
      P(1, "A", "kid", { birthday: "2018-12-20" }),
      P(2, "B", "kid", { birthday: "2018-11-20" }),
      P(3, "C", "kid", { birthday: "2018-06-01" }),
      P(4, "D", "kid", { birthday: "2018-11-16", archived: true }),
      P(5, "Santa", "other", { birthday: "1900-12-01", giverOnly: true }),
    ];
    expect(upcomingBirthdays(people, "2026-11-15").map((x) => x.person.id)).toEqual([2, 1]);
    const seasons = [S(1, "birthday", { honoreeId: 2, date: "2026-11-20" }), S(2, "christmas")];
    expect(findBirthdaySeason(seasons, 2, "2026-11-20")?.id).toBe(1);
    expect(findBirthdaySeason(seasons, 1, "2026-12-20")).toBeUndefined();
  });
});

describe("similar hint", () => {
  const item = (o: Partial<SimilarGift> = {}): SimilarGift => ({ giftId: 7, title: "LEGO Set", seasonName: "Christmas 2025", seasonDate: "2025-12-25", status: "given", ...o });
  it("formats the first match, past and upcoming", () => {
    expect(similarHintText([item()], "Ava", "2026-11-15")).toBe("🔁 Looks like Ava got “LEGO Set” in Christmas 2025");
    expect(similarHint([item({ seasonName: "Ava's Birthday 2027", seasonDate: "2027-03-01" })], "Ava", "2026-11-15")?.lead).toBe("Looks like Ava is already getting");
    expect(similarHintText([item(), item({ giftId: 8 }), item({ giftId: 9 })], "Ava", "2026-11-15")).toBe("🔁 Looks like Ava got “LEGO Set” in Christmas 2025 (and 2 more)");
    expect(similarHint([], "Ava")).toBeNull();
    expect(similarHintText([], "Ava")).toBe("");
  });
  it("normalizes titles like the server and builds the query", () => {
    expect(normalizeTitle("  LEGO®  Set!! (Big) ")).toBe("lego set big");
    expect(canCheckSimilar("Lego")).toBe(true);
    expect(canCheckSimilar("a.b!")).toBe(false);
    expect(similarQueryString({ recipientId: 4, title: "LEGO & co", excludeId: 9 })).toBe("?recipientId=4&title=LEGO+%26+co&excludeId=9");
  });
  it("groups history by year", () => {
    const h = [{ season: S(3, "birthday", { date: "2026-03-01" }) }, { season: S(2, "christmas", { date: "2025-12-25" }) }, { season: S(1, "birthday", { date: "2025-03-01" }) }, { season: S(0, "other", { date: null, name: "Old" }) }];
    expect(groupHistoryByYear(h).map((g) => [g.year, g.entries.length])).toEqual([["2026", 1], ["2025", 2], ["Earlier", 1]]);
  });
});

describe("name draw", () => {
  it("marks a pair done only for a matching gift in this season", () => {
    const pair = { giverId: 4, recipientId: 5 };
    expect(pairHasGift(pair, [G({ recipientId: 5, giverIds: [4, 6] })], 1)).toBe(true);
    expect(pairHasGift(pair, [G({ recipientId: 5, giverIds: [6] })], 1)).toBe(false);
    expect(pairHasGift(pair, [G({ recipientId: 4, giverIds: [5] })], 1)).toBe(false);
    expect(pairHasGift(pair, [G({ recipientId: 5, giverIds: [4], seasonId: 2 })], 1)).toBe(false);
    expect(pairHasGift(pair, [G({ recipientId: 5, giverIds: [4], status: "returned" })], 1)).toBe(false);
    expect(pairHasGift(pair, [], 1)).toBe(false);
  });
  it("preselects kids and prefills the gift link", () => {
    const people = [P(1, "Mom", "parent"), P(4, "Emma", "kid"), P(5, "Noah", "kid", { archived: true }), P(6, "Lily", "kid"), P(3, "Santa", "kid", { giverOnly: true })];
    expect(defaultDrawParticipants(people)).toEqual([4, 6]);
    expect(drawGiftHref({ giverId: 4, recipientId: 6 })).toBe("/gifts/new?recipient=6&from=4");
  });
  it("accepts both draw response shapes", () => {
    expect(toDrawResult([{ giverId: 1, recipientId: 2 }])).toEqual({ pairs: [{ giverId: 1, recipientId: 2 }] });
    expect(toDrawResult({ pairs: [], note: "Couldn't avoid last year" })).toEqual({ pairs: [], note: "Couldn't avoid last year" });
    expect(toDrawResult(null)).toEqual({ pairs: [] });
  });
});

describe("season grouping", () => {
  it("groups into Christmas, Birthdays, Other, dropping empty groups", () => {
    const seasons = [S(1, "christmas"), S(2, "birthday"), S(3, "anniversary"), S(4, "christmas"), S(5, "other")];
    expect(groupSeasons(seasons).map((g) => [g.label, g.seasons.map((s) => s.id)])).toEqual([
      ["Christmas", [1, 4]],
      ["Birthdays", [2]],
      ["Other", [3, 5]],
    ]);
    expect(groupSeasons([S(1, "birthday")]).map((g) => g.key)).toEqual(["birthday"]);
    expect(groupSeasons([])).toEqual([]);
  });
  it("puts the honoree first and hides fairness for birthdays only", () => {
    const rows = [{ personId: 1 }, { personId: 2 }, { personId: 3 }];
    expect(honoreeFirst(rows, { kind: "birthday", honoreeId: 3 }).map((r) => r.personId)).toEqual([3, 1, 2]);
    expect(honoreeFirst(rows, { kind: "anniversary", honoreeId: 3 }).map((r) => r.personId)).toEqual([1, 2, 3]);
    expect(showFairness({ kind: "birthday" })).toBe(false);
    expect(showFairness({ kind: "christmas" })).toBe(true);
  });
});

describe("price watch, activity and passkeys", () => {
  it("shows a drop badge only on unbought gifts", () => {
    expect(priceWatchInfo({ status: "idea", watchPrice: true, priceDroppedAt: "2026-11-01T00:00:00Z", lowestSeenPriceCents: 4499 })).toEqual({ dropped: true, lowest: "Lowest $44.99" });
    expect(priceWatchInfo({ status: "ordered", watchPrice: true, priceDroppedAt: "2026-11-01T00:00:00Z", lowestSeenPriceCents: 4000 })).toEqual({ dropped: false, lowest: "Lowest $40" });
    expect(priceWatchInfo({ status: "idea", watchPrice: false, priceDroppedAt: null, lowestSeenPriceCents: 100 })).toEqual({ dropped: false, lowest: null });
  });
  it("names system activity rows", () => {
    expect(activityActor({ userId: null, userName: null })).toBe("Price watch");
    expect(activityActor({ userId: 2, userName: "Dad" })).toBe("Dad");
  });
  it("picks a device name", () => {
    expect(defaultDeviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(defaultDeviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac");
    expect(defaultDeviceName("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile")).toBe("Android phone");
    expect(defaultDeviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows PC");
    expect(defaultDeviceName("")).toBe("This device");
  });
  it("gives friendly passkey errors", () => {
    const cancel = Object.assign(new Error("x"), { name: "NotAllowedError" });
    expect(passkeyError(cancel, "login")).toEqual({ message: "Passkey sign-in was cancelled.", quiet: true });
    expect(passkeyError(Object.assign(new Error("x"), { name: "NotSupportedError" }), "register").message).toMatch(/aren't supported/);
    expect(passkeyError(Object.assign(new Error("x"), { name: "InvalidStateError" }), "register").message).toMatch(/already has a passkey/);
    expect(passkeyError(new ApiError(429, "slow down"), "login").message).toMatch(/Too many/);
    expect(passkeyError(new ApiError(401, "nope"), "login").message).toMatch(/isn't recognized/);
  });
});
