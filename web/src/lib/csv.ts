// Client-side helpers for CSV import/export. The server does the real parsing and
// validation (POST /api/import with dryRun); these only shape the UI around it.
import type { ImportRow } from "../api";

/**
 * Counts the data rows in a CSV (everything after the header), honouring quoted fields
 * that contain commas, doubled quotes, or newlines. Blank lines are ignored.
 */
export function csvDataRowCount(text: string): number {
  let rows = 0;
  let inQuotes = false;
  let lineHasContent = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') i++;
        else inQuotes = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      lineHasContent = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      if (lineHasContent) rows++;
      lineHasContent = false;
    } else if (ch.trim() !== "") {
      lineHasContent = true;
    }
  }
  if (lineHasContent) rows++;
  return Math.max(0, rows - 1);
}

export interface ImportSummary {
  total: number;
  ok: number;
  errors: number;
}

export function summarizeImport(rows: ImportRow[]): ImportSummary {
  const ok = rows.filter((r) => r.ok).length;
  return { total: rows.length, ok, errors: rows.length - ok };
}

/** Error rows first (by line), then the good rows, so problems are visible without scrolling. */
export function orderImportRows(rows: ImportRow[]): ImportRow[] {
  return [...rows].sort((a, b) => Number(a.ok) - Number(b.ok) || a.line - b.line);
}

/** Parses the import target select value: "inbox" → null, otherwise a season id. */
export function parseImportTarget(v: string): number | null {
  if (v === "inbox" || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "1 gift" / "3 gifts". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
