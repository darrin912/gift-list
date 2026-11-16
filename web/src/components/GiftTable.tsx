import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Gift, GiftStatus, Person } from "../api";
import { ALL_STATUSES, effectivePriceCents, formatCents, STATUS_LABEL } from "../lib/format";
import { sortGifts, type SortDir, type SortKey } from "../lib/lists";
import { useUpdateGift } from "../lib/queries";
import { priceWatchInfo } from "../lib/phase3";
import { giversLabel, PriceDropBadge, WishlistBadges } from "./GiftCard";
import { recipientColor, recipientLabel, recipientSortKey } from "../lib/recipients";
import { IconStar } from "./Icons";
import { statusVar } from "./ui";

const COLS: { key: SortKey; label: string; className?: string }[] = [
  { key: "title", label: "Gift" },
  { key: "recipient", label: "For" },
  { key: "status", label: "Status" },
  { key: "price", label: "Price", className: "text-right" },
  { key: "store", label: "Store" },
];

/**
 * Compact sortable table. On phones it scrolls sideways inside its own container
 * (never the page); the gift column stays pinned on the left.
 */
export default function GiftTable({ gifts, map, showRecipient = true }: { gifts: Gift[]; map: Map<number, Person>; showRecipient?: boolean }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "recipient", dir: "asc" });
  const navigate = useNavigate();
  const update = useUpdateGift();
  const rows = sortGifts(gifts, sort.key, sort.dir, (g) => recipientSortKey(g, map));
  const cols = COLS.filter((c) => showRecipient || c.key !== "recipient");

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "price" ? "desc" : "asc" }));

  return (
    <div className="card overflow-x-auto overscroll-x-contain">
      <table className="w-full min-w-[640px] border-collapse text-left text-[15px]">
        <thead>
          <tr className="border-b border-line bg-surface-2">
            {cols.map((c, i) => {
              const active = sort.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={`${i === 0 ? "sticky left-0 z-10 bg-surface-2" : ""} whitespace-nowrap p-0 ${c.className ?? ""}`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    className={`inline-flex min-h-[44px] w-full items-center gap-1 px-3 text-[13px] font-semibold ${c.className?.includes("right") ? "justify-end" : ""} ${active ? "text-ink" : "text-muted"}`}
                  >
                    {c.label}
                    <span aria-hidden="true" className={`text-[11px] ${active ? "" : "opacity-0"}`}>
                      {sort.dir === "asc" ? "▲" : "▼"}
                    </span>
                  </button>
                </th>
              );
            })}
            <th scope="col" className="whitespace-nowrap px-3 text-[13px] font-semibold text-muted">
              From
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => {
            const price = effectivePriceCents(g);
            const watch = priceWatchInfo(g);
            return (
              <tr key={g.id} className="group cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => navigate(`/gifts/${g.id}`)}>
                <th scope="row" className="sticky left-0 z-10 max-w-[11rem] bg-surface px-3 py-2 font-semibold group-hover:bg-surface-2 sm:max-w-[16rem]" style={{ boxShadow: `inset 3px 0 0 ${recipientColor(g, map)}` }}>
                  <Link to={`/gifts/${g.id}`} className="line-clamp-2 leading-snug" onClick={(e) => e.stopPropagation()}>
                    {g.wished && <IconStar filled size={13} className="-mt-0.5 mr-1 inline text-gold" aria-label="Wished for" />}
                    <span className={g.withdrawnAt ? "text-muted" : ""}>{g.title}</span>
                  </Link>
                  <WishlistBadges gift={g} className="mt-1" />
                </th>
                {showRecipient && (
                  <td className="whitespace-nowrap px-3 py-2">
                    {recipientLabel(g, map, { emoji: true })}
                  </td>
                )}
                <td className="whitespace-nowrap px-1 py-1" onClick={(e) => e.stopPropagation()}>
                  <label className="relative inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-2.5 text-[14px] font-semibold" style={{ color: statusVar(g.status) }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: statusVar(g.status) }} />
                    {STATUS_LABEL[g.status]}
                    <select
                      aria-label={`Status for ${g.title}`}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      value={g.status}
                      onChange={(e) => update.mutate({ id: g.id, input: { status: e.target.value as GiftStatus } })}
                    >
                      {ALL_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                </td>
                <td className="tnum whitespace-nowrap px-3 py-2 text-right">
                  {price ? formatCents(price) : <span className="text-muted">–</span>}
                  {price > 0 && g.actualPriceCents === null && <span className="ml-1 text-[12px] text-muted">est.</span>}
                  {watch.dropped && <PriceDropBadge className="ml-1.5" />}
                  {watch.lowest && <span className="block text-[12px] text-muted">{watch.lowest}</span>}
                </td>
                <td className="max-w-[9rem] truncate whitespace-nowrap px-3 py-2 text-muted">{g.store || "–"}</td>
                <td className="max-w-[10rem] truncate whitespace-nowrap px-3 py-2 text-muted">{giversLabel(g.giverIds, map) || "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
