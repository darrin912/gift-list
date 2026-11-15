import { Link } from "react-router-dom";
import type { Gift, GiftStatus, Person } from "../api";
import { ADVANCE_LABEL, ALL_STATUSES, CATEGORY_LABEL, effectivePriceCents, formatCents, nextStatus, returnLevel, returnPhrase, STATUS_LABEL } from "../lib/format";
import { useUpdateGift } from "../lib/queries";
import { IconCheck, IconStar } from "./Icons";
import { StatusTrack, statusVar } from "./ui";

export function giversLabel(ids: number[], map: Map<number, Person>): string {
  const names = ids.map((id) => map.get(id)?.name).filter(Boolean) as string[];
  if (!names.length) return "";
  if (names.length <= 2) return names.join(" & ");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

export default function GiftCard({ gift, map, showRecipient = true }: { gift: Gift; map: Map<number, Person>; showRecipient?: boolean }) {
  const update = useUpdateGift();
  const recipient = map.get(gift.recipientId);
  const next = nextStatus(gift.status);
  const price = effectivePriceCents(gift);
  const level = returnLevel(gift.returnBy, gift.status);
  const from = giversLabel(gift.giverIds, map);
  const setStatus = (status: GiftStatus) => update.mutate({ id: gift.id, input: { status } });
  const color = recipient?.color || "var(--line)";

  return (
    <article
      className="tag-hole card relative overflow-hidden"
      style={{ borderLeft: `5px solid ${color}` }}
      aria-label={gift.title}
    >
      <Link to={`/gifts/${gift.id}`} className="block py-3.5 pl-9 pr-4 hover:bg-surface-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {showRecipient && (
              <div className="mb-0.5 text-[14px] font-semibold" style={{ color: recipient?.color || "var(--muted)" }}>
                {recipient?.emoji ? `${recipient.emoji} ` : ""}
                {recipient?.name ?? "Unknown"}
              </div>
            )}
            <h3 className="text-[17px] font-bold leading-snug">
              {gift.wished && <IconStar filled size={15} className="-mt-0.5 mr-1 inline text-gold" aria-label="Wished for" />}
              {gift.title}
            </h3>
            <p className="mt-0.5 truncate text-[14px] text-muted">
              {[gift.category !== "main" ? CATEGORY_LABEL[gift.category] : null, gift.store, from ? `From ${from}` : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="tnum text-[17px] font-bold">{price ? formatCents(price) : <span className="text-muted">–</span>}</div>
            {gift.actualPriceCents === null && gift.estPriceCents !== null && <div className="text-[12px] text-muted">est.</div>}
          </div>
        </div>
        {level && gift.returnBy && (
          <p className="mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold" style={{ color: level === "red" ? "var(--berry)" : "var(--gold)", background: level === "red" ? "var(--berry-soft)" : "var(--gold-soft)" }}>
            {returnPhrase(gift.returnBy)}
          </p>
        )}
      </Link>
      <div className="flex items-center gap-2 border-t border-line py-2 pl-9 pr-2">
        <label className="relative flex min-h-[44px] flex-1 items-center gap-2.5" title="Change status">
          <StatusTrack status={gift.status} />
          <span className="text-[14px] font-semibold" style={{ color: statusVar(gift.status) }}>
            {STATUS_LABEL[gift.status]}
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
          <select
            aria-label={`Status for ${gift.title}`}
            className="absolute inset-0 cursor-pointer opacity-0"
            value={gift.status}
            onChange={(e) => setStatus(e.target.value as GiftStatus)}
          >
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {next && (
          <button
            type="button"
            onClick={() => setStatus(next)}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold transition-transform active:scale-95"
            style={{ color: statusVar(next), background: `color-mix(in srgb, ${statusVar(next)} 13%, transparent)` }}
            aria-label={`Mark ${gift.title} as ${STATUS_LABEL[next].toLowerCase()}`}
          >
            <IconCheck size={18} strokeWidth={2.6} />
            {ADVANCE_LABEL[gift.status]}
          </button>
        )}
      </div>
    </article>
  );
}
