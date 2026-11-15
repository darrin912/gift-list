import { useCallback, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api, type Gift } from "../api";
import { effectivePriceCents, formatCents, recipientsOf } from "../lib/format";
import { groupByRecipient } from "../lib/lists";
import { useGifts, useInvalidateGifts, usePeople, usePeopleMap, useUpdateGift } from "../lib/queries";
import { useSeason } from "../lib/season";
import { EmptyState, ErrorNote, Loading, PersonBadge, UndoBar, type UndoState } from "../components/ui";
import { IconArrowRight, IconPlus, IconStar } from "../components/Icons";
import { ListHeader } from "./ListsPage";

export default function IdeasPage() {
  const { seasons, season: selected } = useSeason();
  const target = seasons.find((s) => s.isActive && !s.archived) ?? selected;
  const ideas = useGifts({ seasonId: "none" });
  const people = usePeople();
  const map = usePeopleMap();
  const update = useUpdateGift();
  const invalidate = useInvalidateGifts();
  const [undo, setUndo] = useState<UndoState | null>(null);
  const clearUndo = useCallback(() => setUndo(null), []);

  const recipients = recipientsOf(people.data ?? []);
  const [title, setTitle] = useState("");
  const [recipientId, setRecipientId] = useState<number>(0);
  const [err, setErr] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => api.gifts.create({ title: title.trim(), recipientId, seasonId: null, status: "idea" }),
    onSuccess: () => {
      setTitle("");
      invalidate();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setErr("What's the idea?");
    if (!recipientId) return setErr("Choose who it's for.");
    setErr(null);
    add.mutate();
  }

  const list = (ideas.data ?? []).filter((g) => g.seasonId === null);
  const groups = groupByRecipient(list, (people.data ?? []).map((p) => p.id));

  const move = (g: Gift) => {
    if (!target) return;
    update.mutate({ id: g.id, input: { seasonId: target.id } });
    setUndo({ message: `Moved “${g.title}” to ${target.name}`, undo: () => update.mutate({ id: g.id, input: { seasonId: null } }) });
  };

  return (
    <>
      <ListHeader title="Ideas inbox" sub="Jot ideas down any time of year. Move them into a season when it's time." />

      <form onSubmit={submit} className="card mb-6 space-y-3 p-4" noValidate>
        <div>
          <label htmlFor="idea-title" className="label">New idea</label>
          <input id="idea-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Telescope, pottery class…" autoComplete="off" />
        </div>
        <div className="flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">For</span>
            <select className="field" value={recipientId || ""} onChange={(e) => setRecipientId(Number(e.target.value))}>
              <option value="">For…</option>
              {recipients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji ? `${p.emoji} ` : ""}
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn-primary shrink-0" disabled={add.isPending}>
            <IconPlus size={20} /> Add
          </button>
        </div>
        {err && <p className="text-[14px] font-medium text-berry">{err}</p>}
        <ErrorNote error={add.error} />
      </form>

      {ideas.isLoading ? (
        <Loading />
      ) : ideas.error ? (
        <ErrorNote error={ideas.error} />
      ) : list.length === 0 ? (
        <EmptyState title="The inbox is empty" body="When someone mentions something they'd love, add it here so it isn't forgotten by December." />
      ) : (
        <div className="space-y-5">
          {groups.map(({ recipientId: rid, gifts }) => {
            const person = map.get(rid);
            return (
              <section key={rid} aria-label={person?.name}>
                <h2 className="mb-2 flex items-center gap-2 text-[17px] font-bold">
                  <PersonBadge person={person} size={28} />
                  {person?.name ?? "Someone"}
                  <span className="tnum text-[14px] font-semibold text-muted">{gifts.length}</span>
                </h2>
                <ul className="card divide-y divide-line overflow-hidden">
                  {gifts.map((g) => {
                    const price = effectivePriceCents(g);
                    return (
                      <li key={g.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 pl-4 pr-2">
                        <Link to={`/gifts/${g.id}`} className="min-w-0 flex-1 basis-40 py-1">
                          <span className="block truncate font-semibold">
                            {g.wished && <IconStar filled size={14} className="-mt-0.5 mr-1 inline text-gold" aria-label="Wished for" />}
                            {g.title}
                          </span>
                          <span className="tnum block truncate text-[14px] text-muted">
                            {[price ? formatCents(price) : null, g.store].filter(Boolean).join(" · ") || "No details yet"}
                          </span>
                        </Link>
                        {target && (
                          <button
                            type="button"
                            onClick={() => move(g)}
                            className="ml-auto inline-flex min-h-[44px] max-w-full shrink-0 items-center gap-1.5 rounded-full bg-pine-soft px-3.5 text-[14px] font-semibold text-pine transition-transform active:scale-95"
                            aria-label={`Move ${g.title} to ${target.name}`}
                          >
                            <span className="truncate">Move to {target.name}</span>
                            <IconArrowRight size={16} className="shrink-0" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <ErrorNote error={update.error} />
      <UndoBar state={undo} onDone={clearUndo} />
    </>
  );
}
