// A small RFC 4180 CSV writer and parser (no dependency).

/** Characters that make spreadsheet apps treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Neutralizes CSV formula injection by prefixing a single quote to text cells that a
 * spreadsheet would evaluate. Only for free-text cells; numeric cells we format ourselves
 * (prices, which are never negative) are written as-is.
 */
export function safeTextCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Undoes safeTextCell on import: "'=foo" -> "=foo". */
export function unescapeTextCell(value: string): string {
  return value.length > 1 && value[0] === "'" && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

function quoteField(value: string): string {
  return /[",\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Writes rows as CSV with CRLF line endings (and a trailing CRLF), optionally with a UTF-8 BOM for Excel. */
export function toCsv(rows: readonly (readonly string[])[], { bom = false } = {}): string {
  const body = rows.map((r) => r.map(quoteField).join(",")).join("\r\n");
  return (bom ? "﻿" : "") + body + (rows.length ? "\r\n" : "");
}

export interface CsvRecord {
  /** 1-based physical line on which the record starts. */
  line: number;
  fields: string[];
}

export class CsvError extends Error {}

/**
 * Parses CSV text. Accepts CRLF, LF or CR line endings, a leading BOM, quoted fields with
 * embedded commas, quotes ("") and newlines. Throws CsvError on an unterminated quote.
 * A trailing newline does not produce an empty record.
 */
export function parseCsv(text: string): CsvRecord[] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let line = 1;
  let recordLine = 1;
  let i = 0;
  let inQuotes = false;
  let quoteLine = 0;
  let atRecordStart = true;

  const endRecord = () => {
    fields.push(field);
    records.push({ line: recordLine, fields });
    fields = [];
    field = "";
    atRecordStart = true;
  };

  while (i < s.length) {
    const ch = s[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        // Embedded newline: keep it (normalized to \n) and count the physical line.
        if (ch === "\r" && s[i + 1] === "\n") i++;
        field += "\n";
        line++;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (atRecordStart) {
      recordLine = line;
      atRecordStart = false;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      quoteLine = line;
      i++;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      i++;
      endRecord();
      line++;
    } else {
      // Lenient: a stray quote inside an unquoted field is kept literally.
      field += ch;
      i++;
    }
  }
  if (inQuotes) throw new CsvError(`Unterminated quoted field starting on line ${quoteLine}`);
  if (!atRecordStart) endRecord();
  return records;
}
