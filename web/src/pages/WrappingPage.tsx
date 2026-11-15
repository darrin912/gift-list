import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import type { Gift, GiftStatus, Person } from "../api";
import { isShared, recipientColor, recipientLabel } from "../lib/recipients";
import { ratio } from "../lib/format";
import { groupByRecipient, wrapProgress } from "../lib/lists";
import { useGifts, usePeople, usePeopleMap, useUpdateGift } from "../lib/queries";
import { useSeason } from "../lib/season";
import { giversLabel } from "../components/GiftCard";
import { EmptyState, ErrorNote, Loading, PersonBadge, QuickAction, UndoBar, type UndoState } from "../components/ui";
import { IconCheck, IconRibbon } from "../components/Icons";
import { ListHeader } from "./ListsPage";

const STATUSES: GiftStatus[] = ["received", "wrapped", "given"];

export default function WrappingPage() {
  const { seasonId, season } = useSeason();
  const gifts = useGifts({ seasonId, status: STATUSES }, seasonId !== undefined);
  const people = usePeople();
  const map = usePeopleMap();
  const update = useUpdateGift();
  const [undo, setUndo] = useState<UndoState | null>(null);
  const clearUndo = useCallback(() => setUndo(null), []);

  const list = (gifts.data ?? []).filter((g) => STATUSES.includes(g.status));
  const toWrap = list.filter((g) => g.status === "received").sort((a, b) => a.title.localeCompare(b.title));
  const tree = list.filter((g) => g.status === "wrapped" || g.status === "given");
  const order = (people.data ?? []).map((p) => p.id);
  const byRecipient = groupByRecipient(tree, order);
  const p = wrapProgress(list);

  const setStatus = (g: Gift, status: GiftStatus, verb: string) => {
    const prev = g.status;
    update.mutate({ id: g.id, input: { status } });
    setUndo({ message: `${verb} “${g.title}”`, undo: () => update.mutate({ id: g.id, input: { status: prev } }) });
  };

  return (
    <>
      <ListHeader title="Wrapping & Christmas Eve" sub={season?.name} />

      {seasonId === undefined ? (
        <EmptyState title="No season yet" body="Create a season in Settings first." action={<Link to="/settings#seasons" className="btn-primary">Create a season</Link>} />
      ) : gifts.isLoading ? (
        <Loading />
      ) : gifts.error ? (
        <ErrorNote error={gifts.error} />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:items-start">
          <div className="space-y-5 md:col-span-2">
            <div className="card grid grid-cols-2 divide-x divide-line">
              <Progress label="Wrapped" done={p.wrapped + p.given} of={p.here} color="var(--st-wrapped)" />
              <Progress label="Given" done={p.given} of={p.here} color="var(--st-given)" />
            </div>
          </div>

          <section aria-labelledby="wrap-h" className="min-w-0">
            <h2 id="wrap-h" className="mb-2 flex items-baseline gap-2 text-[19px] font-bold">
              To wrap <span className="tnum text-[15px] font-semibold text-muted">{toWrap.length}</span>
            </h2>
            {toWrap.length === 0 ? (
              <p className="card px-4 py-5 text-muted">{p.here ? "All wrapped. Time for cocoa." : "Gifts show up here once they've arrived (status Received)."}</p>
            ) : (
              <ul className="card divide-y divide-line overflow-hidden">
                {toWrap.map((g) => (
                  <WrapRow key={g.id} g={g} map={map} onWrap={() => setStatus(g, "wrapped", "Wrapped")} />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="tree-h" className="min-w-0">
            <h2 id="tree-h" className="mb-2 flex items-baseline gap-2 text-[19px] font-bold">
              Under the tree <span className="tnum text-[15px] font-semibold text-muted">{p.given} of {tree.length} given</span>
            </h2>
            {byRecipient.length === 0 ? (
              <p className="card px-4 py-5 text-muted">Wrapped gifts land here as a Christmas Eve checklist, by person, with who each is from.</p>
            ) : (
              <div className="space-y-3">
                {byRecipient.map(({ recipientId, gifts: gs }) => {
                  const family = recipientId === "family";
                  const person = family ? undefined : map.get(recipientId);
                  const given = gs.filter((g) => g.status === "given").length;
                  return (
                    <div key={recipientId} className="card overflow-hidden" style={{ borderTop: `4px solid ${family ? "var(--gold)" : person?.color || "var(--line)"}` }}>
                      <div className="flex items-center gap-3 px-4 pb-1 pt-3">
                        {family ? (
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold-soft text-[16px]" aria-hidden="true">🏠</span>
                        ) : (
                          <PersonBadge person={person} size={32} />
                        )}
                        <h3 className="min-w-0 flex-1 truncate text-[17px] font-bold">{family ? "Family" : (person?.name ?? "Someone")}</h3>
                        <span className="tnum text-[14px] text-muted">
                          {given}/{gs.length}
                        </span>
                      </div>
                      <ul>
                        {gs.map((g) => (
                          <TreeRow
                            key={g.id}
                            g={g}
                            from={giversLabel(g.giverIds, map)}
                            forLabel={isShared(g) ? recipientLabel(g, map) : null}
                            onToggle={() => (g.status === "given" ? setStatus(g, "wrapped", "Unchecked") : setStatus(g, "given", "Given"))}
                          />
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
      <ErrorNote error={update.error} />
      <UndoBar state={undo} onDone={clearUndo} />
    </>
  );
}

function Progress({ label, done, of, color }: { label: string; done: number; of: number; color: string }) {
  return (
    <div className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-semibold text-muted">{label}</span>
        <span className="tnum text-[15px]">
          <b className="text-[22px]">{done}</b>
          <span className="text-muted"> / {of}</span>
        </span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full transition-[width]" style={{ width: `${ratio(done, of) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function WrapRow({ g, map, onWrap }: { g: Gift; map: Map<number, Person>; onWrap: () => void }) {
  const from = giversLabel(g.giverIds, map);
  return (
    <li className="flex items-center gap-2 py-2 pl-4 pr-2">
      <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: recipientColor(g, map) }} aria-hidden="true" />
      <Link to={`/gifts/${g.id}`} className="min-w-0 flex-1 py-1">
        <span className="block truncate font-semibold">{g.title}</span>
        <span className="block truncate text-[14px] text-muted">
          For {recipientLabel(g, map, { family: "the family" })}
          {from && ` · From ${from}`}
        </span>
      </Link>
      <QuickAction label="Wrapped" color="var(--st-wrapped)" icon={<IconRibbon size={18} />} ariaLabel={`Mark ${g.title} as wrapped`} onClick={onWrap} />
    </li>
  );
}

function TreeRow({ g, from, forLabel = null, onToggle }: { g: Gift; from: string; forLabel?: string | null; onToggle: () => void }) {
  const given = g.status === "given";
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={given}
        onClick={onToggle}
        className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2"
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition-colors"
          style={{ borderColor: given ? "var(--st-given)" : "var(--line)", background: given ? "var(--st-given)" : "transparent", color: "var(--surface)" }}
          aria-hidden="true"
        >
          {given && <IconCheck size={18} strokeWidth={3} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-semibold ${given ? "text-muted line-through decoration-2" : ""}`}>{g.title}</span>
          <span className="block truncate text-[14px] text-muted">
            {forLabel && `for ${forLabel} · `}
            {from ? `From: ${from}` : "From: (no tag yet)"}
          </span>
        </span>
        {!given && <span className="shrink-0 text-[14px] font-semibold text-st-given">Given</span>}
      </button>
    </li>
  );
}
