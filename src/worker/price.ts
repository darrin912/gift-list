// Parsing and formatting of human-written prices. Money is always integer cents.

/** Same sanity cap as validation.ts ($10M). */
export const MAX_PRICE_CENTS = 10_000_000_00;

/**
 * Parses a human price like "$1,234.50", "12", "19.99 USD", "1.234,50" or "€ 9,99" to cents.
 * Returns null for blank or unparseable input, negatives, and amounts over the cap.
 */
export function parsePriceToCents(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) && input >= 0 && input * 100 <= MAX_PRICE_CENTS ? Math.round(input * 100) : null;
  }
  // Keep digits and separators only; anything else (currency symbols, codes, spaces) is noise.
  const s = input.trim();
  if (!s || /-\s*\d|\d\s*-/.test(s)) return null; // negatives ("-5", "$-5") and ranges ("10-20")
  let num = s.replace(/[^\d.,]/g, "");
  if (!/\d/.test(num)) return null;
  const lastDot = num.lastIndexOf(".");
  const lastComma = num.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the decimal separator.
    num = lastDot > lastComma ? num.replace(/,/g, "") : num.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    // Only commas: "9,99" is a decimal comma; "1,234" / "1,234,567" are thousands.
    num = /^\d+,\d{1,2}$/.test(num) ? num.replace(",", ".") : num.replace(/,/g, "");
  } else if ((num.match(/\./g) ?? []).length > 1) {
    // "1.234.567" are thousands dots.
    num = num.replace(/\./g, "");
  }
  if (!/^\d*\.?\d*$/.test(num) || num === ".") return null;
  const value = Number(num);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return cents <= MAX_PRICE_CENTS ? cents : null;
}

/** 1234 -> "12.34"; null -> "". */
export function formatCents(cents: number | null): string {
  if (cents == null) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
