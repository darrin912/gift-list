import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { GiftCategory, GiftFilters, GiftStatus } from "../api";
import { ALL_STATUSES, CATEGORIES, CATEGORY_LABEL, effectivePriceCents, formatCents, isGiverOnly, STATUS_LABEL } from "../lib/format";
import { readGiftsView, storeGiftsView, type GiftsView } from "../lib/prefs";
import GiftTable from "../components/GiftTable";
import { useGifts, usePeople, usePeopleMap, useStores } from "../lib/queries";
import { useSeason } from "../lib/season";
import GiftCard from "../components/GiftCard";
import { EmptyState, ErrorNote, Loading, PageHeader, statusVar } from "../components/ui";
import { IconCards, IconFilter, IconPlus, IconSearch, IconStar, IconTable, IconX } from "../components/Icons";

/** Scope values in the URL: a season (default), "inbox" for the ideas inbox, or "all". */
type Scope = "season" | "inbox" | "all";

export default function GiftsPage() {
  const [sp, setSp] = useSearchParams();
  const { seasonId, season } = useSeason();
  const people = usePeople();
  const map = usePeopleMap();
  const stores = useStores();
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [view, setViewState] = useState<GiftsView>(readGiftsView);
  const setView = (v: GiftsView) => {
    setViewState(v);
    storeGiftsView(v);
  };

  const scope = (sp.get("scope") as Scope) || "season";
  const statuses = (sp.get("status")?.split(",").filter(Boolean) ?? []) as GiftStatus[];

  const filters: GiftFilters = useMemo(
    () => ({
      seasonId: scope === "inbox" ? "none" : scope === "all" ? undefined : seasonId,
      recipientId: sp.get("recipient") ? Number(sp.get("recipient")) : undefined,
      status: statuses.length ? statuses : undefined,
      category: (sp.get("category") as GiftCategory) || undefined,
      store: sp.get("store") || undefined,
      giverId: sp.get("from") ? Number(sp.get("from")) : undefined,
      wished: sp.get("wished") === "1" || undefined,
      q: sp.get("q") || undefined,
    }),
    [sp.toString(), seasonId, scope],
  );

  const needsSeason = scope === "season" && seasonId === undefined;
  const gifts = useGifts(filters, !needsSeason);

  // Debounce the search box into the URL.
  useEffect(() => {
    const t = setTimeout(() => set("q", search.trim() || null), 250);
    return () => clearTimeout(t);
  }, [search]);

  function set(key: string, value: string | null) {
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (value === null || value === "") n.delete(key);
        else n.set(key, value);
        return n;
      },
      { replace: true },
    );
  }

  const toggleStatus = (s: GiftStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    set("status", next.join(",") || null);
  };

  const activeCount = ["recipient", "category", "store", "from", "wished"].filter((k) => sp.get(k)).length;
  const list = gifts.data ?? [];
  const total = list.reduce((sum, g) => sum + (g.status === "idea" || g.status === "returned" ? 0 : effectivePriceCents(g)), 0);
  const activePeople = (people.data ?? []).filter((p) => !p.archived);
  const newHref = `/gifts/new${filters.recipientId ? `?recipient=${filters.recipientId}` : scope === "inbox" ? "?inbox=1" : ""}`;

  return (
    <>
      <PageHeader
        title="Gifts"
        sub={scope === "inbox" ? "Ideas inbox: no season yet" : scope === "all" ? "Every season" : season?.name}
        right={
          <Link to={newHref} className="btn-primary hidden md:inline-flex">
            <IconPlus size={20} /> Add gift
          </Link>
        }
      />

      <div className="mb-3 flex gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Which gifts">
        {(
          [
            ["season", "This season"],
            ["inbox", "Ideas inbox"],
            ["all", "All"],
          ] as [Scope, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            role="tab"
            aria-selected={scope === v}
            onClick={() => set("scope", v === "season" ? null : v)}
            className={`min-h-[40px] flex-1 rounded-lg text-[15px] font-semibold transition-colors ${scope === v ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search gifts</span>
          <IconSearch size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            className="field pl-11"
            placeholder="Search title, notes, store"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={`btn-quiet relative !px-3.5 ${showFilters ? "!border-pine" : ""}`}
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          aria-controls="gift-filters"
        >
          <IconFilter size={20} />
          <span className="hidden sm:inline">Filters</span>
          {activeCount > 0 && (
            <span className="tnum absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-berry px-1 text-[12px] font-bold text-pine-ink">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" aria-label="Filter by status">
        {ALL_STATUSES.map((s) => {
          const on = statuses.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => toggleStatus(s)}
              className="chip shrink-0"
              style={on ? { background: statusVar(s), borderColor: statusVar(s), color: "var(--surface)" } : undefined}
            >
              {!on && <span className="h-2 w-2 rounded-full" style={{ background: statusVar(s) }} />}
              {STATUS_LABEL[s]}
            </button>
          );
        })}
      </div>

      {showFilters && (
        <div id="gift-filters" className="card mt-3 grid gap-3 p-4 sm:grid-cols-2">
          <Select label="For" value={sp.get("recipient") ?? ""} onChange={(v) => set("recipient", v)}>
            <option value="">Anyone</option>
            {activePeople.filter((p) => !isGiverOnly(p)).map((p) => (
              <option key={p.id} value={p.id}>
                {p.emoji ? `${p.emoji} ` : ""}
                {p.name}
              </option>
            ))}
          </Select>
          <Select label="From" value={sp.get("from") ?? ""} onChange={(v) => set("from", v)}>
            <option value="">Anyone</option>
            {activePeople.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select label="Category" value={sp.get("category") ?? ""} onChange={(v) => set("category", v)}>
            <option value="">Any category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
          <Select label="Store" value={sp.get("store") ?? ""} onChange={(v) => set("store", v)}>
            <option value="">Any store</option>
            {(stores.data ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <button
            type="button"
            className="chip justify-center sm:col-span-1"
            aria-pressed={sp.get("wished") === "1"}
            onClick={() => set("wished", sp.get("wished") === "1" ? null : "1")}
          >
            <IconStar size={16} filled={sp.get("wished") === "1"} /> Wished for only
          </button>
          {activeCount > 0 && (
            <button
              type="button"
              className="chip justify-center text-muted"
              onClick={() => ["recipient", "from", "category", "store", "wished"].forEach((k) => set(k, null))}
            >
              <IconX size={16} /> Clear filters
            </button>
          )}
        </div>
      )}

      <div className="mt-5">
        {needsSeason ? (
          <EmptyState title="No season yet" body="Create a season in Settings, or look in the ideas inbox." action={<Link to="/settings#seasons" className="btn-primary">Create a season</Link>} />
        ) : gifts.isLoading ? (
          <Loading />
        ) : gifts.error ? (
          <ErrorNote error={gifts.error} />
        ) : list.length === 0 ? (
          <EmptyState
            title={statuses.length || activeCount || filters.q ? "No gifts match" : "No gifts yet"}
            body={statuses.length || activeCount || filters.q ? "Try removing a filter." : "Add the first idea. It can be rough; you can fill in prices and stores later."}
            action={<Link to={newHref} className="btn-primary"><IconPlus size={20} /> Add gift</Link>}
          />
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="tnum min-w-0 text-[14px] text-muted">
                {list.length} {list.length === 1 ? "gift" : "gifts"}
                {total > 0 && ` · ${formatCents(total)} planned or bought`}
              </p>
              <div className="flex shrink-0 gap-0.5 rounded-xl bg-surface-2 p-1" role="group" aria-label="View">
                {(
                  [
                    ["cards", "Cards", IconCards],
                    ["table", "Table", IconTable],
                  ] as const
                ).map(([v, label, Icon]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    aria-label={`${label} view`}
                    title={`${label} view`}
                    onClick={() => setView(v)}
                    className={`flex h-9 w-10 items-center justify-center rounded-lg transition-colors ${view === v ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
                  >
                    <Icon size={19} />
                  </button>
                ))}
              </div>
            </div>
            {view === "table" ? (
              <GiftTable gifts={list} map={map} />
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {list.map((g) => (
                  <li key={g.id}>
                    <GiftCard gift={g} map={map} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <Link
        to={newHref}
        className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-30 inline-flex h-14 items-center gap-2 rounded-full bg-berry pl-4 pr-5 text-[16px] font-bold text-pine-ink shadow-[0_10px_24px_-8px_rgba(120,20,40,0.6)] transition-transform active:scale-95 md:hidden"
      >
        <IconPlus size={22} strokeWidth={2.6} /> Add gift
      </Link>
    </>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string | null) => void; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value || null)}>
        {children}
      </select>
    </label>
  );
}
