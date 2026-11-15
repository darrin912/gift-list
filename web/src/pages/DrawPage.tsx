import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type DrawPair, type DrawResult, type Person } from "../api";
import { recipientsOf } from "../lib/format";
import { defaultDrawParticipants, drawGiftHref, pairHasGift } from "../lib/phase3";
import { qk, useDraw, useGifts, usePeople, usePeopleMap } from "../lib/queries";
import { useSeason } from "../lib/season";
import { EmptyState, ErrorNote, Loading, PersonBadge, Toggle } from "../components/ui";
import { IconArrowRight, IconCheck, IconPlus, IconShuffle } from "../components/Icons";
import { ListHeader } from "./ListsPage";

const SHUFFLE_MS = 1100;

export default function DrawPage() {
  const { season, seasonId } = useSeason();
  const people = usePeople();
  const map = usePeopleMap();
  const draw = useDraw(seasonId);
  const gifts = useGifts({ seasonId }, seasonId !== undefined);
  const qc = useQueryClient();

  const candidates = recipientsOf(people.data ?? []);
  const [picked, setPicked] = useState<number[] | null>(null);
  const selected = picked ?? defaultDrawParticipants(people.data ?? []);
  const [avoid, setAvoid] = useState(true);
  const [picking, setPicking] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  // Bumped on each fresh draw so the reveal animation replays.
  const [revealKey, setRevealKey] = useState(0);
  const [note, setNote] = useState<string | undefined>();

  const run = useMutation({
    mutationFn: async (): Promise<DrawResult> => {
      // A short, deliberate shuffle before the reveal, however fast the server is.
      const [r] = await Promise.all([api.seasons.runDraw(seasonId!, { participantIds: selected, avoidPreviousSeason: avoid }), new Promise((ok) => setTimeout(ok, SHUFFLE_MS))]);
      return r;
    },
    onMutate: () => setShuffling(true),
    onSuccess: (r) => {
      qc.setQueryData(qk.draw(seasonId!), { pairs: r.pairs });
      setNote(r.note);
      setPicking(false);
      setRevealKey((k) => k + 1);
    },
    onSettled: () => setShuffling(false),
  });
  const clear = useMutation({
    mutationFn: () => api.seasons.clearDraw(seasonId!),
    onSuccess: () => {
      qc.setQueryData(qk.draw(seasonId!), { pairs: [] });
      setNote(undefined);
      setPicking(false);
    },
  });

  if (!season) return <EmptyState title="No season yet" body="Create a season in Settings first." action={<Link to="/settings#seasons" className="btn-primary">Go to Settings</Link>} />;

  const pairs = draw.data?.pairs ?? [];
  const showPicker = picking || (!draw.isLoading && pairs.length === 0);
  const done = pairs.filter((p) => pairHasGift(p, gifts.data ?? [], seasonId)).length;
  const toggle = (id: number) => setPicked(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const start = () => {
    if (pairs.length && !window.confirm("Draw again? This replaces the current pairs.")) return;
    run.mutate();
  };

  return (
    <>
      <ListHeader title="Name draw" sub={`Everyone draws one name to give to, for ${season.name}.`} />
      {(draw.isLoading || people.isLoading) && <Loading />}
      <ErrorNote error={draw.error || people.error} />

      {shuffling ? (
        <Shuffling people={selected.map((id) => map.get(id)).filter((p): p is Person => !!p)} />
      ) : showPicker && !draw.isLoading ? (
        <section className="card p-5" aria-labelledby="who-h">
          <h2 id="who-h" className="text-[19px] font-bold">Who's in?</h2>
          <p className="text-[14px] text-muted">Kids are picked to start. Tap to add or remove anyone.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {candidates.map((p) => (
              <button key={p.id} type="button" className="chip !pl-1.5" aria-pressed={selected.includes(p.id)} onClick={() => toggle(p.id)}>
                <PersonBadge person={p} size={28} />
                {p.name}
              </button>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-1">
            <Toggle checked={avoid} onChange={setAvoid} label="Avoid last year's pairs" hint="Nobody gets the same name as the last draw." />
          </div>
          <ErrorNote error={run.error && (run.error instanceof ApiError ? run.error : new Error("Couldn't draw names. Try again."))} />
          <div className="mt-4 flex gap-2">
            {pairs.length > 0 && (
              <button type="button" className="btn-quiet flex-1" onClick={() => setPicking(false)}>
                Cancel
              </button>
            )}
            <button type="button" className="btn-primary flex-[2]" disabled={selected.length < 2 || run.isPending} onClick={start}>
              <IconShuffle size={20} />
              {selected.length < 2 ? "Pick at least 2" : `Draw names for ${selected.length}`}
            </button>
          </div>
        </section>
      ) : null}

      {!shuffling && !showPicker && pairs.length > 0 && (
        <section aria-labelledby="pairs-h">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="pairs-h" className="text-[19px] font-bold">This year's names</h2>
            <span className="tnum text-[14px] font-semibold text-muted">
              {done} of {pairs.length} have a gift
            </span>
          </div>
          {note && <p className="mb-3 rounded-xl bg-gold-soft px-4 py-3 text-[14px] text-ink">{note}</p>}
          <ul key={revealKey} className="space-y-2.5">
            {pairs.map((pair, i) => (
              <PairRow key={`${pair.giverId}-${pair.recipientId}`} pair={pair} map={map} index={i} animate={revealKey > 0} done={pairHasGift(pair, gifts.data ?? [], seasonId)} />
            ))}
          </ul>
          <ErrorNote error={clear.error} />
          <div className="mt-5 flex gap-2">
            <button type="button" className="btn-quiet flex-1" onClick={() => setPicking(true)}>
              <IconShuffle size={19} /> Draw again
            </button>
            <button
              type="button"
              className="btn-danger flex-1"
              disabled={clear.isPending}
              onClick={() => window.confirm("Clear the draw? The pairs will be gone (gifts stay).") && clear.mutate()}
            >
              Clear draw
            </button>
          </div>
        </section>
      )}
    </>
  );
}

function PairRow({ pair, map, index, animate, done }: { pair: DrawPair; map: Map<number, Person>; index: number; animate: boolean; done: boolean }) {
  const giver = map.get(pair.giverId);
  const to = map.get(pair.recipientId);
  return (
    <li className={`card flex items-center gap-2 py-2.5 pl-3 pr-2 ${animate ? "draw-reveal" : ""}`} style={animate ? { animationDelay: `${index * 140}ms` } : undefined}>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <PersonBadge person={giver} size={34} />
        <span className="min-w-0 truncate font-bold">{giver?.name ?? "?"}</span>
        <IconArrowRight size={18} className="shrink-0 text-muted" aria-label="gives to" />
        <PersonBadge person={to} size={34} />
        <span className="min-w-0 truncate font-bold" style={{ color: to?.color || undefined }}>{to?.name ?? "?"}</span>
      </span>
      {done ? (
        <span className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-full bg-pine-soft px-3 text-[14px] font-bold text-pine" aria-label={`${giver?.name} has a gift for ${to?.name}`}>
          <IconCheck size={17} strokeWidth={2.8} /> Gift
        </span>
      ) : (
        <Link to={drawGiftHref(pair)} className="chip shrink-0 !min-h-[40px] !px-3 text-[14px] font-semibold" aria-label={`Add a gift from ${giver?.name} for ${to?.name}`}>
          <IconPlus size={16} /> gift
        </Link>
      )}
    </li>
  );
}

/** A brief "names in the hat" moment while the draw runs. */
function Shuffling({ people }: { people: Person[] }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 160);
    return () => clearInterval(t);
  }, []);
  const name = people.length ? people[tick % people.length].name : "";
  return (
    <section className="card flex flex-col items-center px-5 py-10 text-center" role="status" aria-live="polite">
      <div className="flex gap-2" aria-hidden="true">
        {people.slice(0, 6).map((p, i) => (
          <span key={p.id} className="draw-shuffle" style={{ animationDelay: `${i * 90}ms` }}>
            <PersonBadge person={p} size={40} />
          </span>
        ))}
      </div>
      <p className="mt-5 text-[15px] text-muted">Shaking the hat…</p>
      <p className="mt-1 h-8 text-[24px] font-extrabold tracking-[-0.02em] [font-stretch:90%]" aria-hidden="true">
        {name}
      </p>
    </section>
  );
}
