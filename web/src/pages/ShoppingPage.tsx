import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import type { Gift, GiftStatus } from "../api";
import { effectivePriceCents, formatCents } from "../lib/format";
import { ANYWHERE, groupByStore, sumCents } from "../lib/lists";
import { useGifts, usePeopleMap, useUpdateGift } from "../lib/queries";
import { useSeason } from "../lib/season";
import { recipientColor, recipientLabel, recipientSortKey } from "../lib/recipients";
import { EmptyState, ErrorNote, Loading, QuickAction, Toggle, UndoBar, type UndoState } from "../components/ui";
import { IconCart, IconCheck, IconStar } from "../components/Icons";
import { ListHeader } from "./ListsPage";

export default function ShoppingPage() {
  const { seasonId, season } = useSeason();
  const [withIdeas, setWithIdeas] = useState(false);
  const statuses: GiftStatus[] = withIdeas ? ["idea", "planned"] : ["planned"];
  const gifts = useGifts({ seasonId, status: statuses }, seasonId !== undefined);
  const map = usePeopleMap();
  const update = useUpdateGift();
  const [undo, setUndo] = useState<UndoState | null>(null);
  const clearUndo = useCallback(() => setUndo(null), []);

  // Filter client-side too, so a tapped "Bought" disappears right away (optimistic update).
  const list = (gifts.data ?? []).filter((g) => statuses.includes(g.status));
  const groups = groupByStore(list, (g) => recipientSortKey(g, map));
  const total = sumCents(list.filter((g) => g.status === "planned"));

  const bought = (g: Gift) => {
    const prev = g.status;
    update.mutate({ id: g.id, input: { status: "ordered" } });
    setUndo({ message: `Bought “${g.title}”`, undo: () => update.mutate({ id: g.id, input: { status: prev } }) });
  };

  return (
    <>
      <ListHeader
        title="Shopping list"
        sub={season ? `${season.name}${list.length ? ` · ${formatCents(total, { round: true })} to spend` : ""}` : undefined}
      />
      <div className="card mb-5 px-4">
        <Toggle checked={withIdeas} onChange={setWithIdeas} label="Include ideas" hint="Show gifts that aren't planned yet, too" />
      </div>

      {seasonId === undefined ? (
        <EmptyState title="No season yet" body="Create a season in Settings first." action={<Link to="/settings#seasons" className="btn-primary">Create a season</Link>} />
      ) : gifts.isLoading ? (
        <Loading />
      ) : gifts.error ? (
        <ErrorNote error={gifts.error} />
      ) : groups.length === 0 ? (
        <EmptyState title="Nothing left to buy" body="Planned gifts show up here, grouped by store. Mark a gift as planned when you've decided on it." />
      ) : (
        <div className="space-y-5">
          {groups.map((grp) => (
            <section key={grp.store} className="card overflow-hidden" aria-label={grp.store}>
              <header className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-3">
                <IconCart size={20} className="shrink-0 text-muted" />
                <h2 className={`min-w-0 flex-1 truncate text-[17px] font-bold ${grp.store === ANYWHERE ? "text-muted" : ""}`}>{grp.store}</h2>
                <span className="tnum shrink-0 text-[15px]">
                  <span className="text-muted">{grp.gifts.length} · </span>
                  <b>{formatCents(grp.subtotalCents)}</b>
                </span>
              </header>
              <ul className="divide-y divide-line">
                {grp.gifts.map((g) => {
                  const price = effectivePriceCents(g);
                  return (
                    <li key={g.id} className="flex items-center gap-2 py-2 pl-4 pr-2">
                      <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: recipientColor(g, map) }} aria-hidden="true" />
                      <Link to={`/gifts/${g.id}`} className="min-w-0 flex-1 py-1">
                        <span className="block truncate font-semibold">
                          {g.wished && <IconStar filled size={14} className="-mt-0.5 mr-1 inline text-gold" aria-label="Wished for" />}
                          {g.title}
                        </span>
                        <span className="tnum block truncate text-[14px] text-muted">
                          {`for ${recipientLabel(g, map, { emoji: true })}`}
                          {" · "}
                          {price ? `${formatCents(price)}${g.actualPriceCents === null ? " est." : ""}` : "no price"}
                          {g.status === "idea" && " · idea"}
                        </span>
                      </Link>
                      <QuickAction
                        label="Bought"
                        color="var(--st-ordered)"
                        icon={<IconCheck size={18} strokeWidth={2.6} />}
                        ariaLabel={`Mark ${g.title} as bought`}
                        onClick={() => bought(g)}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <ErrorNote error={update.error} />
      <UndoBar state={undo} onDone={clearUndo} />
    </>
  );
}
