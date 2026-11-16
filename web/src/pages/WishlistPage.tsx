import { useCallback, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type WishInput, type WishItem } from "../api";
import { CATEGORIES, CATEGORY_LABEL, centsToInput, formatCents, isHttpUrl } from "../lib/format";
import { looksLikeUrl, mergePreview } from "../lib/lists";
import { qk, useMe, useUsers, useWishlist } from "../lib/queries";
import { useSeason } from "../lib/season";
import {
  emptyWishlistText,
  linkHost,
  otherUsersLabel,
  removeConfirmText,
  todayUtc,
  wishChanges,
  wishFormFrom,
  wishInputFrom,
  wishSeasons,
  type WishForm,
} from "../lib/wishlist";
import { EmptyState, ErrorNote, Loading, Markdown, MarkdownHint, Sheet, UndoBar, type UndoState } from "../components/ui";
import { IconLink, IconPencil, IconPlus, IconSparkle, IconStar, IconTrash } from "../components/Icons";
import { ListHeader } from "./ListsPage";
import { Money } from "./GiftFormPage";

const PRIORITIES: { v: 1 | 2 | 3; label: string }[] = [
  { v: 1, label: "Really want" },
  { v: 2, label: "Would like" },
  { v: 3, label: "Nice to have" },
];

/** Link auto-fill shared by quick-add and the edit sheet (same endpoint and wording as the gift form). */
function useAutofill<T extends WishForm>(get: () => T, set: (f: T) => void) {
  const [note, setNote] = useState<{ kind: "ok" | "blocked" | "empty" | "error"; text: string } | null>(null);
  const m = useMutation({
    mutationFn: (url: string) => api.linkPreview(url),
    onMutate: () => setNote(null),
    onSuccess: (p) => {
      const { next, filled } = mergePreview(get(), p, centsToInput);
      set(next);
      const names: Record<string, string> = { title: "title", imageUrl: "picture", est: "price" };
      const list = filled.map((k) => names[k]).filter(Boolean).join(", ");
      if (p.blocked) setNote({ kind: "blocked", text: `This store didn't let us peek at the page${list ? ` (we filled in the ${list})` : ""}.` });
      else if (list) setNote({ kind: "ok", text: `Filled in the ${list}.` });
      else setNote({ kind: "empty", text: "Nothing new to fill in from that page." });
    },
    onError: (e) =>
      setNote({
        kind: "error",
        text: e instanceof ApiError && e.status === 400 ? "That link can't be previewed." : e instanceof ApiError && e.status === 429 ? "Too many previews in a minute. Try again shortly." : "Couldn't reach that page right now.",
      }),
  });
  const run = (url: string) => {
    const u = url.trim();
    if (!isHttpUrl(u)) return setNote({ kind: "error", text: "Paste a link that starts with http:// or https://." });
    m.mutate(u);
  };
  return { run, pending: m.isPending, note, clear: () => setNote(null) };
}

export default function WishlistPage() {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const me = useMe();
  const users = useUsers();
  const wishes = useWishlist();
  const { seasons } = useSeason();
  const others = otherUsersLabel(users.data ?? [], me.data?.id);
  const [editing, setEditing] = useState<WishItem | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const clearUndo = useCallback(() => setUndo(null), []);
  const refresh = () => qc.invalidateQueries({ queryKey: qk.wishlist });

  const [f, setF] = useState<WishForm>(() => ({ ...wishFormFrom(), title: sp.get("title") ?? "" }));
  const latest = useRef(f);
  latest.current = f;
  const [err, setErr] = useState<string | null>(null);
  const fill = useAutofill(() => latest.current, setF);

  const add = useMutation({
    mutationFn: (input: WishInput & { title: string }) => api.wishlist.create(input),
    onSuccess: () => {
      setF(wishFormFrom());
      fill.clear();
      if (sp.get("title")) setSp({}, { replace: true });
      refresh();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const r = wishInputFrom(f);
    if ("error" in r) return setErr(r.error);
    setErr(null);
    add.mutate(r.input);
  }

  const list = wishes.data ?? [];
  const seasonName = (id: number | null) => (id == null ? null : (seasons.find((s) => s.id === id)?.name ?? null));

  return (
    <>
      <ListHeader
        title="My wishlist"
        sub={`${others ?? "Your family"} can see this list. What happens next stays a surprise.`}
      />

      <form onSubmit={submit} className="card mb-6 space-y-3 p-4" noValidate aria-label="Add a wish">
        <div>
          <label htmlFor="wish-title" className="label">Add a wish</label>
          <input
            id="wish-title"
            className="field"
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
            placeholder="Cozy slippers, a pottery class…"
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="wish-url" className="label">Link (optional)</label>
          <div className="flex gap-2">
            <input
              id="wish-url"
              className="field min-w-0 flex-1"
              type="url"
              inputMode="url"
              value={f.url}
              onChange={(e) => setF({ ...f, url: e.target.value })}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (looksLikeUrl(text) && !f.url.trim()) setTimeout(() => fill.run(text), 0);
              }}
              placeholder="Paste a product link"
            />
            <button type="button" className="btn-quiet shrink-0 !px-3.5" onClick={() => fill.run(f.url)} disabled={fill.pending || !f.url.trim()}>
              <IconSparkle size={18} className={fill.pending ? "animate-pulse" : ""} />
              <span className="hidden min-[380px]:inline">{fill.pending ? "Looking…" : "Auto-fill"}</span>
            </button>
          </div>
          <AutofillNote note={fill.note} />
        </div>
        {(f.imageUrl || f.est) && (
          <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-2">
            {f.imageUrl && isHttpUrl(f.imageUrl) && <Thumb src={f.imageUrl} size={48} />}
            <div className="min-w-0 flex-1 text-[14px] text-muted">
              {f.est && <span className="tnum">About ${f.est}</span>}
            </div>
            <button type="button" className="text-[14px] font-semibold text-muted underline underline-offset-4" onClick={() => setF({ ...f, imageUrl: "", est: "" })}>
              Clear
            </button>
          </div>
        )}
        <button type="submit" className="btn-primary w-full" disabled={add.isPending}>
          <IconPlus size={20} /> {add.isPending ? "Adding…" : "Add to my list"}
        </button>
        {err && <p className="text-[14px] font-medium text-berry">{err}</p>}
        <ErrorNote error={add.error} />
      </form>

      {wishes.isLoading ? (
        <Loading />
      ) : wishes.error ? (
        <ErrorNote error={wishes.error} />
      ) : list.length === 0 ? (
        <EmptyState title="Your wishlist is empty" body={emptyWishlistText(others)} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="My wishes">
          {list.map((w) => (
            <li key={w.id}>
              <WishCard wish={w} season={seasonName(w.seasonId)} onEdit={() => setEditing(w)} />
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <EditWish
          wish={editing}
          others={others}
          onClose={() => setEditing(null)}
          onSaved={(before, changes) => {
            setEditing(null);
            refresh();
            const back = Object.fromEntries(Object.keys(changes).map((k) => [k, before[k as keyof WishItem]])) as WishInput;
            setUndo({
              message: `Saved “${changes.title ?? before.title}”`,
              undo: () => void api.wishlist.update(before.id, back).then(refresh),
            });
          }}
          onRemoved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      <UndoBar state={undo} onDone={clearUndo} />
    </>
  );
}

function AutofillNote({ note }: { note: { kind: "ok" | "blocked" | "empty" | "error"; text: string } | null }) {
  if (!note) return <p className="mt-1.5 text-[13px] text-muted">Paste a link and we'll fill in the title, picture, and price.</p>;
  return (
    <p
      role="status"
      className={`mt-2 rounded-xl px-3 py-2 text-[14px] ${note.kind === "ok" ? "bg-pine-soft text-pine" : note.kind === "error" ? "bg-berry-soft text-berry" : "bg-gold-soft text-gold"}`}
    >
      {note.text}
    </p>
  );
}

function Thumb({ src, size }: { src: string; size: number }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-xl border border-line bg-surface object-contain"
      style={{ width: size, height: size }}
      referrerPolicy="no-referrer"
      onError={() => setOk(false)}
    />
  );
}

function WishCard({ wish, season, onEdit }: { wish: WishItem; season: string | null; onEdit: () => void }) {
  const priority = PRIORITIES.find((p) => p.v === wish.priority)?.label;
  const meta = [
    wish.category !== "main" ? CATEGORY_LABEL[wish.category] : null,
    wish.estPriceCents != null ? `about ${formatCents(wish.estPriceCents)}` : null,
    season,
  ].filter(Boolean);
  return (
    <article className="card relative overflow-hidden" aria-label={wish.title} style={{ borderLeft: "5px solid var(--berry)" }}>
      <div className="flex gap-3 p-4 pb-3">
        {wish.imageUrl && isHttpUrl(wish.imageUrl) && <Thumb src={wish.imageUrl} size={64} />}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center whitespace-nowrap rounded-full bg-pine-soft px-2 py-0.5 text-[12px] font-bold text-pine">On your list</span>
            {wish.priority === 1 && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gold-soft px-2 py-0.5 text-[12px] font-bold text-gold">
                <IconStar filled size={12} /> {priority}
              </span>
            )}
          </div>
          <h3 className="break-words text-[17px] font-bold leading-snug">{wish.title}</h3>
          {meta.length > 0 && <p className="tnum mt-0.5 truncate text-[14px] text-muted">{meta.join(" · ")}</p>}
          {wish.priority !== 1 && <p className="text-[13px] text-muted">{priority}</p>}
          {wish.url && isHttpUrl(wish.url) && (
            <a href={wish.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 text-[14px] font-semibold text-pine">
              <IconLink size={15} className="shrink-0" />
              <span className="truncate underline decoration-1 underline-offset-4">{linkHost(wish.url)}</span>
            </a>
          )}
        </div>
      </div>
      {wish.description?.trim() && <Markdown text={wish.description} className="line-clamp-3 -mt-1 px-4 pb-3 text-[14px] text-muted" />}
      <div className="flex border-t border-line px-2 py-1">
        <button type="button" onClick={onEdit} className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 text-[15px] font-semibold text-pine hover:bg-surface-2" aria-label={`Edit ${wish.title}`}>
          <IconPencil size={18} /> Edit
        </button>
      </div>
    </article>
  );
}

function EditWish({
  wish,
  others,
  onClose,
  onSaved,
  onRemoved,
}: {
  wish: WishItem;
  others: string | null;
  onClose: () => void;
  onSaved: (before: WishItem, changes: WishInput) => void;
  onRemoved: () => void;
}) {
  const { seasons } = useSeason();
  const [f, setF] = useState<WishForm>(() => wishFormFrom(wish));
  const latest = useRef(f);
  latest.current = f;
  const fill = useAutofill(() => latest.current, setF);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const set = <K extends keyof WishForm>(k: K, v: WishForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const choices = wishSeasons(seasons, todayUtc());
  const keepCurrent = f.seasonId != null && !choices.some((s) => s.id === f.seasonId);

  const save = useMutation({
    mutationFn: (changes: WishInput) => api.wishlist.update(wish.id, changes),
    onSuccess: (_w, changes) => onSaved(wish, changes),
  });
  const remove = useMutation({ mutationFn: () => api.wishlist.remove(wish.id), onSuccess: onRemoved });

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const r = wishInputFrom(f);
    if ("error" in r) return setErr(r.error);
    setErr(null);
    const changes = wishChanges(wish, r.input);
    if (Object.keys(changes).length === 0) return onClose();
    save.mutate(changes);
  }

  return (
    <Sheet
      title="Edit wish"
      onClose={onClose}
      footer={
        confirming ? (
          <div className="space-y-3" role="alertdialog" aria-label="Remove from my list?">
            <p className="text-[15px] font-medium">{removeConfirmText(others)}</p>
            <div className="flex gap-3">
              <button type="button" className="btn-quiet flex-1" onClick={() => setConfirming(false)}>
                Keep it
              </button>
              <button type="button" className="btn-danger flex-1" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending ? "Removing…" : "Remove from my list"}
              </button>
            </div>
            <ErrorNote error={remove.error} />
          </div>
        ) : (
          <div className="flex gap-3">
            <button type="button" className="btn-danger !px-4" aria-label="Remove from my list" onClick={() => setConfirming(true)}>
              <IconTrash size={20} />
            </button>
            <button type="submit" form="wish-form" className="btn-primary flex-1" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        )
      }
    >
      <form id="wish-form" onSubmit={submit} className="space-y-5" noValidate>
        <Field label="What would you love?" htmlFor="w-title">
          <input id="w-title" className="field text-[18px] font-semibold" value={f.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Link" htmlFor="w-url">
          <div className="flex gap-2">
            <input id="w-url" className="field min-w-0 flex-1" type="url" inputMode="url" value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="Paste a product link" />
            <button type="button" className="btn-quiet shrink-0 !px-3.5" onClick={() => fill.run(f.url)} disabled={fill.pending || !f.url.trim()}>
              <IconSparkle size={18} className={fill.pending ? "animate-pulse" : ""} />
              {fill.pending ? "Looking…" : "Auto-fill"}
            </button>
          </div>
          <AutofillNote note={fill.note} />
        </Field>
        <Field label="Picture link" htmlFor="w-img">
          <input id="w-img" className="field" type="url" inputMode="url" value={f.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://" />
          {f.imageUrl && isHttpUrl(f.imageUrl) && (
            <div className="mt-2 flex h-32 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface">
              <img src={f.imageUrl} alt="" className="h-full w-full object-contain" referrerPolicy="no-referrer" />
            </div>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="About how much?" htmlFor="w-est">
            <Money id="w-est" value={f.est} onChange={(v) => set("est", v)} />
          </Field>
          <Field label="When" htmlFor="w-season">
            <select id="w-season" className="field" value={f.seasonId ?? "none"} onChange={(e) => set("seasonId", e.target.value === "none" ? null : Number(e.target.value))}>
              <option value="none">Any time</option>
              {keepCurrent && <option value={f.seasonId!}>{seasons.find((s) => s.id === f.seasonId)?.name ?? "Current"}</option>}
              {choices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <fieldset>
          <legend className="label">How much do you want it?</legend>
          <div className="flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1">
            {PRIORITIES.map((p) => (
              <button
                key={p.v}
                type="button"
                aria-pressed={f.priority === p.v}
                onClick={() => set("priority", p.v)}
                className={`min-h-[40px] flex-1 whitespace-nowrap rounded-lg px-2 text-[14px] font-semibold ${f.priority === p.v ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="label">Kind</legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={f.category === c} onClick={() => set("category", c)}>
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label="Notes" htmlFor="w-notes">
          <textarea id="w-notes" className="field min-h-[96px]" value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Size, color, which one…" />
          <MarkdownHint />
        </Field>
        {err && <p role="alert" className="rounded-xl bg-berry-soft px-4 py-3 text-[15px] font-medium text-berry">{err}</p>}
        <ErrorNote error={save.error} />
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
    </div>
  );
}
