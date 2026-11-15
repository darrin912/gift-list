import type { ActivityEntry } from "../api";
import { formatDate, todayISO } from "./format";

/** Local YYYY-MM-DD for an ISO timestamp. */
export function localDay(iso: string): string {
  return todayISO(new Date(iso));
}

/** "just now", "5 min ago", "3 h ago", "Yesterday", "Nov 12". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.floor((now.getTime() - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const today = todayISO(now);
  const day = localDay(iso);
  if (day === today) return `${Math.floor(mins / 60)} h ago`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day === todayISO(y)) return "Yesterday";
  return formatDate(day, today);
}

/** Day heading for the activity page. */
export function dayLabel(day: string, now: Date = new Date()): string {
  const today = todayISO(now);
  if (day === today) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day === todayISO(y)) return "Yesterday";
  return formatDate(day, today);
}

/** Groups newest-first entries by local day, preserving order. */
export function groupByDay(entries: ActivityEntry[]): { day: string; entries: ActivityEntry[] }[] {
  const out: { day: string; entries: ActivityEntry[] }[] = [];
  for (const e of entries) {
    const d = localDay(e.at);
    const last = out[out.length - 1];
    if (last && last.day === d) last.entries.push(e);
    else out.push({ day: d, entries: [e] });
  }
  return out;
}
