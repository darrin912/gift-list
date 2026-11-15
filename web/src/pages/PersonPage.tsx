import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { ALL_STATUSES, centsToInput, effectivePriceCents, formatCents, formatDate, KIND_LABEL, parseDollars, STATUS_LABEL } from "../lib/format";
import { useBudgets, useGifts, useHistory, useMe, usePeople, usePeopleMap } from "../lib/queries";
import { useSeason } from "../lib/season";
import { groupHistoryByYear, inDays, nextBirthday } from "../lib/phase3";
import GiftCard from "../components/GiftCard";
import { EmptyState, ErrorNote, Loading, Markdown, MoneyBar, PersonBadge, StatusPill, statusVar } from "../components/ui";
import { IconChevronLeft, IconPlus } from "../components/Icons";
import { Money } from "./GiftFormPage";

export default function PersonPage() {
  const id = Number(useParams().id);
  const people = usePeople(true);
  const map = usePeopleMap();
  const me = useMe();
  const { season, seasonId } = useSeason();
  const giverOnly = people.data?.find((x) => x.id === id)?.giverOnly === true;
  // Giver-only labels (Santa) never receive gifts: show the gifts tagged from them instead.
  const gifts = useGifts(giverOnly ? { seasonId, giverId: id } : { seasonId, recipientId: id }, seasonId !== undefined && !!people.data);

  if (people.isLoading) return <Loading />;
  const p = people.data?.find((x) => x.id === id);
  if (!p) return <ErrorNote error={people.error ?? new Error("This person doesn't exist.")} />;

  const isMe = me.data?.personId === p.id;
  const list = gifts.data ?? [];
  const sizes = Object.entries(p.sizes ?? {}).filter(([, v]) => v);
  const spent = list.filter((g) => ["ordered", "received", "wrapped", "given"].includes(g.status)).reduce((s, g) => s + effectivePriceCents(g), 0);
  const committed = list.filter((g) => g.status === "planned").reduce((s, g) => s + effectivePriceCents(g), 0);

  return (
    <>
      <Link to="/people" className="-ml-2 mb-2 inline-flex min-h-[44px] items-center gap-1 pr-3 font-semibold text-muted">
        <IconChevronLeft size={20} /> People
      </Link>
      <div className="mb-6 flex items-center gap-4">
        <PersonBadge person={p} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[30px] font-extrabold leading-tight tracking-[-0.02em] [font-stretch:92%]">{p.name}</h1>
          <p className="text-muted">
            {KIND_LABEL[p.kind]}
            {p.birthday && ` · Birthday ${formatDate(p.birthday, "0000")}`}
            {(() => {
              const nb = !p.giverOnly && !p.archived ? nextBirthday(p.birthday) : null;
              return nb && nb.days <= 60 ? ` · 🎂 ${inDays(nb.days)}` : null;
            })()}
            {p.archived && " · Archived"}
          </p>
        </div>
        <Link to={`/people/${p.id}/edit`} className="btn-quiet">
          Edit
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:items-start">
        <div className="space-y-5">
          {season && !isMe && !giverOnly && <BudgetCard personId={p.id} seasonId={season.id} seasonName={season.name} spent={spent} committed={committed} />}

          <section className="card p-5">
            <h2 className="mb-3 text-[19px] font-bold">Sizes</h2>
            {sizes.length ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {sizes.map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-surface-2 px-3 py-2">
                    <dt className="text-[13px] capitalize text-muted">{k}</dt>
                    <dd className="font-bold">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-muted">
                No sizes yet. <Link to={`/people/${p.id}/edit`} className="font-semibold text-pine underline underline-offset-4">Add sizes</Link>
              </p>
            )}
            {(p.likes || p.dislikes || p.notes) && (
              <div className="mt-4 space-y-3 border-t border-line pt-4">
                {p.likes && <Note label="Likes" text={p.likes} />}
                {p.dislikes && <Note label="Dislikes" text={p.dislikes} />}
                {p.notes && (
                  <div>
                    <div className="text-[13px] font-semibold text-muted">Notes</div>
                    <Markdown text={p.notes} />
                  </div>
                )}
              </div>
            )}
          </section>
          {!giverOnly && <History personId={p.id} />}
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[19px] font-bold">{giverOnly ? `From ${p.name}` : "Gifts"}{season ? ` · ${season.name}` : ""}</h2>
            {!isMe && !giverOnly && (
              <Link to={`/gifts/new?recipient=${p.id}`} className="chip">
                <IconPlus size={16} /> Add
              </Link>
            )}
          </div>
          {isMe ? (
            <EmptyState title="🤫 Surprises hidden" body="Gifts for you stay hidden until the season is over." />
          ) : gifts.isLoading ? (
            <Loading />
          ) : list.length === 0 ? (
            giverOnly ? (
              <EmptyState title={`No gifts from ${p.name} yet`} body="Pick this tag in a gift's “From” field." />
            ) : (
            <EmptyState title={`No gifts for ${p.name} yet`} action={<Link to={`/gifts/new?recipient=${p.id}`} className="btn-primary"><IconPlus size={20} /> Add a gift</Link>} />
            )
          ) : (
            <div className="space-y-5">
              {ALL_STATUSES.map((s) => {
                const group = list.filter((g) => g.status === s);
                if (!group.length) return null;
                return (
                  <div key={s}>
                    <h3 className="mb-2 flex items-center gap-2 text-[15px] font-semibold" style={{ color: statusVar(s) }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: statusVar(s) }} />
                      {STATUS_LABEL[s]} <span className="tnum text-muted">{group.length}</span>
                    </h3>
                    <ul className="grid grid-cols-1 gap-3">
                      {group.map((g) => (
                        <li key={g.id}>
                          <GiftCard gift={g} map={map} showRecipient={giverOnly} />
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

/** Gifts from earlier seasons, grouped by year (surprises stay hidden server-side). */
function History({ personId }: { personId: number }) {
  const q = useHistory(personId);
  const groups = groupHistoryByYear((q.data ?? []).filter((h) => h.gifts.length));
  return (
    <section className="card p-5" aria-labelledby="hist-h">
      <h2 id="hist-h" className="text-[19px] font-bold">History</h2>
      <p className="text-[14px] text-muted">What they got in other seasons.</p>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <div className="mt-3"><ErrorNote error={q.error} /></div>
      ) : groups.length === 0 ? (
        <p className="mt-3 text-muted">Nothing from earlier seasons yet.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.map((g) => (
            <div key={g.year}>
              <h3 className="tnum mb-1 text-[22px] font-extrabold leading-none tracking-[-0.02em] text-muted [font-stretch:90%]">{g.year}</h3>
              {g.entries.map(({ season, gifts }) => (
                <div key={season.id} className="mt-2">
                  <div className="text-[14px] font-semibold">{season.name}</div>
                  <ul className="mt-1 divide-y divide-line rounded-xl border border-line">
                    {gifts.map((gift) => (
                      <li key={gift.id}>
                        <Link to={`/gifts/${gift.id}`} className="flex min-h-[48px] items-center gap-3 px-3 py-2 hover:bg-surface-2">
                          <span className="min-w-0 flex-1 truncate">{gift.title}</span>
                          {effectivePriceCents(gift) > 0 && <span className="tnum shrink-0 text-[14px] text-muted">{formatCents(effectivePriceCents(gift))}</span>}
                          <StatusPill status={gift.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Note({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-muted">{label}</div>
      <p className="whitespace-pre-line">{text}</p>
    </div>
  );
}

function BudgetCard({ personId, seasonId, seasonName, spent, committed }: { personId: number; seasonId: number; seasonName: string; spent: number; committed: number }) {
  const budgets = useBudgets(seasonId);
  const qc = useQueryClient();
  const row = budgets.data?.find((b) => b.personId === personId);
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState("");
  const [stocking, setStocking] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setBudget(centsToInput(row?.budgetCents ?? null));
    setStocking(centsToInput(row?.stockingBudgetCents ?? null));
  }, [row?.budgetCents, row?.stockingBudgetCents]);

  const save = useMutation({
    mutationFn: (b: { budgetCents: number; stockingBudgetCents: number }) => api.seasons.setBudget(seasonId, personId, b),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets", seasonId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setEditing(false);
    },
  });

  const b = row?.budgetCents ?? 0;
  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[19px] font-bold">Budget</h2>
        <span className="text-[14px] text-muted">{seasonName}</span>
      </div>
      {!editing ? (
        <>
          <p className="tnum mt-2 text-[15px] text-muted">
            <b className="text-[24px] text-ink">{formatCents(spent + committed, { round: true })}</b> {b > 0 ? `of ${formatCents(b, { round: true })}` : "· no budget set"}
          </p>
          {b > 0 && <MoneyBar spent={spent} committed={committed} budget={b} className="mt-3" />}
          {(row?.stockingBudgetCents ?? 0) > 0 && <p className="mt-2 text-[14px] text-muted">🧦 Stocking budget {formatCents(row!.stockingBudgetCents)}</p>}
          <button type="button" className="btn-quiet mt-4 w-full" onClick={() => setEditing(true)}>
            {b > 0 ? "Change budget" : "Set budget"}
          </button>
        </>
      ) : (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const bc = parseDollars(budget) ?? 0;
            const sc = parseDollars(stocking) ?? 0;
            if (Number.isNaN(bc) || Number.isNaN(sc)) return setErr("Enter amounts in dollars, like 250.");
            setErr(null);
            save.mutate({ budgetCents: bc, stockingBudgetCents: sc });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pb" className="label">Gifts</label>
              <Money id="pb" value={budget} onChange={setBudget} />
            </div>
            <div>
              <label htmlFor="ps" className="label">Stocking</label>
              <Money id="ps" value={stocking} onChange={setStocking} />
            </div>
          </div>
          {err && <p className="text-[14px] font-medium text-berry">{err}</p>}
          <ErrorNote error={save.error} />
          <div className="flex gap-2">
            <button type="button" className="btn-quiet flex-1" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={save.isPending}>Save budget</button>
          </div>
        </form>
      )}
    </section>
  );
}
