import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { GiftStatus, Person } from "../api";
import { ApiError } from "../api";
import { ratio, STATUS_FLOW, STATUS_LABEL } from "../lib/format";
import { IconX } from "./Icons";

export const statusVar = (s: GiftStatus) => `var(--st-${s})`;

export function StatusPill({ status }: { status: GiftStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold"
      style={{ color: statusVar(status), background: `color-mix(in srgb, ${statusVar(status)} 14%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusVar(status) }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Six beads on a ribbon: how far a gift is along idea → given. */
export function StatusTrack({ status }: { status: GiftStatus }) {
  const idx = STATUS_FLOW.indexOf(status);
  const color = statusVar(status);
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {STATUS_FLOW.map((s, i) => (
        <span
          key={s}
          className="h-1.5 rounded-full transition-all"
          style={{
            width: i === idx ? 18 : 6,
            background: idx >= 0 && i <= idx ? color : "var(--line)",
          }}
        />
      ))}
    </div>
  );
}

/** A budget bar: solid = spent, hatched = committed (planned). Overspend turns the track berry. */
export function MoneyBar({ spent, committed, budget, className = "" }: { spent: number; committed: number; budget: number; className?: string }) {
  const over = spent + committed > budget && budget > 0;
  const total = Math.max(budget, spent + committed, 1);
  const s = ratio(spent, total) * 100;
  const c = ratio(committed, total) * 100;
  return (
    <div
      className={`relative h-3 w-full overflow-hidden rounded-full bg-surface-2 ${className}`}
      role="img"
      aria-label={`Spent ${Math.round(s)}%, committed ${Math.round(c)}%`}
    >
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${s}%`, background: over ? "var(--berry)" : "var(--pine)" }} />
      <div
        className="absolute inset-y-0"
        style={{
          left: `${s}%`,
          width: `${c}%`,
          background: `repeating-linear-gradient(-45deg, ${over ? "var(--berry)" : "var(--pine)"} 0 3px, transparent 3px 6px)`,
          opacity: 0.55,
        }}
      />
      {over && budget > 0 && (
        <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${ratio(budget, total) * 100}%` }} title="Budget" />
      )}
    </div>
  );
}

export function PersonBadge({ person, size = 36 }: { person: Person | undefined; size?: number }) {
  const color = person?.color || "var(--muted)";
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        background: `color-mix(in srgb, ${color} 18%, var(--surface))`,
        boxShadow: `inset 0 0 0 2px ${color}`,
        color,
      }}
      aria-hidden="true"
    >
      {person?.emoji || (person?.name?.[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-start gap-3 border-dashed p-6">
      <h3 className="text-[19px] font-bold leading-tight">{title}</h3>
      {body && <p className="max-w-prose text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Something went wrong.";
  return (
    <p role="alert" className="rounded-xl bg-berry-soft px-4 py-3 text-[15px] font-medium text-berry">
      {msg}
    </p>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-pine" />
      {label}
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.02em] [font-stretch:92%]">{title}</h1>
        {sub && <p className="mt-1 text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/**
 * Full-screen sheet on phones, centered panel on larger screens.
 * `onClose` runs on the X button and Escape.
 */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:bg-black/40 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-in flex h-full w-full flex-col bg-bg sm:h-auto sm:max-h-[92vh] sm:max-w-xl sm:rounded-3xl sm:border sm:border-line">
        <div className="pt-safe flex items-center gap-2 border-b border-line bg-surface px-2 sm:rounded-t-3xl">
          <button type="button" onClick={onClose} className="flex h-12 w-12 items-center justify-center rounded-full text-muted hover:bg-surface-2" aria-label="Close">
            <IconX />
          </button>
          <h2 className="flex-1 truncate text-[18px] font-bold">{title}</h2>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">{children}</div>
        {footer && <div className="border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:rounded-b-3xl sm:px-6">{footer}</div>}
      </div>
    </div>
  );
}

export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-semibold text-pine underline decoration-2 underline-offset-4">
      {children}
    </Link>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-4">
      <span>
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-[14px] text-muted">{hint}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-8 w-[52px] rounded-full bg-surface-2 ring-1 ring-line transition-colors peer-checked:bg-pine peer-focus-visible:ring-2 peer-focus-visible:ring-pine" />
        <span className="absolute left-1 top-1 h-6 w-6 rounded-full bg-surface shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
