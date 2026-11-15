import { describe, expect, it } from "vitest";
import {
  centsToInput,
  daysUntil,
  effectivePriceCents,
  formatCents,
  formatDate,
  nextStatus,
  parseDollars,
  ratio,
  returnLevel,
} from "./format";
import { giftQueryString } from "../api";

describe("money", () => {
  it("formats cents as USD", () => {
    expect(formatCents(0)).toBe("$0");
    expect(formatCents(4500)).toBe("$45");
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-2550)).toBe("-$25.50");
    expect(formatCents(1999, { round: true })).toBe("$20");
    expect(formatCents(null)).toBe("–");
  });

  it("parses dollar input into cents", () => {
    expect(parseDollars("")).toBeNull();
    expect(parseDollars("  ")).toBeNull();
    expect(parseDollars("12")).toBe(1200);
    expect(parseDollars("$12.5")).toBe(1250);
    expect(parseDollars("1,299.99")).toBe(129999);
    expect(parseDollars(".99")).toBe(99);
    expect(parseDollars("0.07")).toBe(7);
    expect(parseDollars("12.345")).toBeNaN();
    expect(parseDollars("abc")).toBeNaN();
    expect(parseDollars("-5")).toBeNaN();
  });

  it("round-trips cents to input", () => {
    expect(centsToInput(null)).toBe("");
    expect(centsToInput(1200)).toBe("12");
    expect(centsToInput(1250)).toBe("12.50");
    expect(parseDollars(centsToInput(129999))).toBe(129999);
  });

  it("uses actual price, then estimate, then 0", () => {
    expect(effectivePriceCents({ actualPriceCents: 500, estPriceCents: 900 })).toBe(500);
    expect(effectivePriceCents({ actualPriceCents: null, estPriceCents: 900 })).toBe(900);
    expect(effectivePriceCents({ actualPriceCents: null, estPriceCents: null })).toBe(0);
  });

  it("clamps ratios", () => {
    expect(ratio(50, 100)).toBe(0.5);
    expect(ratio(150, 100)).toBe(1);
    expect(ratio(0, 0)).toBe(0);
    expect(ratio(10, 0)).toBe(1);
  });
});

describe("status flow", () => {
  it("advances idea → given and stops", () => {
    expect(nextStatus("idea")).toBe("planned");
    expect(nextStatus("planned")).toBe("ordered");
    expect(nextStatus("wrapped")).toBe("given");
    expect(nextStatus("given")).toBeNull();
    expect(nextStatus("returned")).toBeNull();
  });
});

describe("dates", () => {
  it("counts days between ISO dates", () => {
    expect(daysUntil("2026-12-25", "2026-12-20")).toBe(5);
    expect(daysUntil("2026-12-01", "2026-12-03")).toBe(-2);
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
  });

  it("applies the return-by warning rule", () => {
    const today = "2026-12-10";
    expect(returnLevel("2026-12-09", "ordered", today)).toBe("red");
    expect(returnLevel("2026-12-10", "received", today)).toBe("amber");
    expect(returnLevel("2026-12-17", "wrapped", today)).toBe("amber");
    expect(returnLevel("2026-12-18", "wrapped", today)).toBeNull();
    expect(returnLevel("2026-12-09", "given", today)).toBeNull();
    expect(returnLevel(null, "ordered", today)).toBeNull();
  });

  it("formats dates without timezone drift", () => {
    expect(formatDate("2026-12-25", "2026-11-15")).toBe("Dec 25");
    expect(formatDate("2027-01-02", "2026-11-15")).toBe("Jan 2, 2027");
    expect(formatDate(null)).toBe("");
  });
});

describe("gift query string", () => {
  it("builds filters per the API contract", () => {
    expect(giftQueryString({})).toBe("");
    expect(giftQueryString({ seasonId: "none" })).toBe("?seasonId=none");
    expect(
      giftQueryString({ seasonId: 3, status: ["ordered", "received"], wished: true, q: " lego ", giverId: 2 }),
    ).toBe("?seasonId=3&status=ordered%2Creceived&giverId=2&wished=1&q=lego");
    expect(giftQueryString({ wished: false, q: "  " })).toBe("");
  });
});
