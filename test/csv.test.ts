import { describe, expect, it } from "vitest";
import { CsvError, parseCsv, safeTextCell, toCsv, unescapeTextCell } from "../src/worker/csv";
import { formatCents, parsePriceToCents } from "../src/worker/price";
import { parseDateCell, slugify } from "../src/worker/routes/csv";

describe("CSV writer", () => {
  it("quotes only when needed and uses CRLF", () => {
    expect(toCsv([["a", "b,c", 'say "hi"', "line1\nline2", " pad", ""]])).toBe(
      'a,"b,c","say ""hi""","line1\nline2"," pad",\r\n',
    );
    expect(toCsv([["x"]], { bom: true })).toBe("﻿x\r\n");
    expect(toCsv([])).toBe("");
  });

  it("escapes formula-looking text cells and unescapes them on import", () => {
    for (const s of ["=SUM(A1)", "+1", "-2", "@cmd", "\tx"]) {
      expect(safeTextCell(s)).toBe(`'${s}`);
      expect(unescapeTextCell(safeTextCell(s))).toBe(s);
    }
    expect(safeTextCell("Lego")).toBe("Lego");
    expect(unescapeTextCell("'quoted'")).toBe("'quoted'");
  });
});

describe("CSV parser", () => {
  it("round-trips the writer's output", () => {
    const rows = [
      ["title", "description"],
      ["Socks, fuzzy", 'He said "warm"\nand cozy'],
      ["", "x"],
    ];
    expect(parseCsv(toCsv(rows, { bom: true })).map((r) => r.fields)).toEqual([
      ["title", "description"],
      ["Socks, fuzzy", 'He said "warm"\nand cozy'],
      ["", "x"],
    ]);
  });

  it("handles BOM, LF/CR/CRLF, embedded newlines, and reports starting lines", () => {
    const recs = parseCsv('﻿a,b\n"multi\r\nline",2\r3,4');
    expect(recs).toEqual([
      { line: 1, fields: ["a", "b"] },
      { line: 2, fields: ["multi\nline", "2"] },
      { line: 4, fields: ["3", "4"] },
    ]);
  });

  it("keeps empty fields and blank lines, and doesn't add a record for a trailing newline", () => {
    expect(parseCsv("a,,c\r\n\r\nd\r\n").map((r) => r.fields)).toEqual([["a", "", "c"], [""], ["d"]]);
    expect(parseCsv("")).toEqual([]);
  });

  it("throws on an unterminated quote", () => {
    expect(() => parseCsv('a,"oops\nb')).toThrow(CsvError);
  });
});

describe("prices and dates", () => {
  it("parses human prices to cents", () => {
    expect(parsePriceToCents("$1,234.50")).toBe(123450);
    expect(parsePriceToCents("12")).toBe(1200);
    expect(parsePriceToCents("19.99 USD")).toBe(1999);
    expect(parsePriceToCents("€ 9,99")).toBe(999);
    expect(parsePriceToCents("1.234,50")).toBe(123450);
    expect(parsePriceToCents("1,234")).toBe(123400);
    expect(parsePriceToCents(24.5)).toBe(2450);
    expect(parsePriceToCents("0.1")).toBe(10);
    for (const bad of ["", "abc", "-5", "$-5", "10-20", ".", null, undefined, "999999999999"]) {
      expect(parsePriceToCents(bad as any), String(bad)).toBeNull();
    }
  });

  it("formats cents as dollars", () => {
    expect(formatCents(1234)).toBe("12.34");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(100000)).toBe("1000.00");
    expect(formatCents(null)).toBe("");
  });

  it("parses date cells", () => {
    expect(parseDateCell("2026-12-24")).toBe("2026-12-24");
    expect(parseDateCell("12/4/2026")).toBe("2026-12-04");
    expect(parseDateCell("1/2/27")).toBe("2027-01-02");
    expect(parseDateCell("")).toBeNull();
    expect(parseDateCell("next week")).toBeUndefined();
  });

  it("slugifies season names for filenames", () => {
    expect(slugify("Christmas 2026!")).toBe("christmas-2026");
    expect(slugify("Ébé's \"Birthday\"")).toBe("ebe-s-birthday");
    expect(slugify("🎄")).toBe("");
  });
});
