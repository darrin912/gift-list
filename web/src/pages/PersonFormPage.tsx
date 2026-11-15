import { useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Person, type PersonInput, type PersonKind } from "../api";
import { KIND_LABEL } from "../lib/format";
import { usePeople } from "../lib/queries";
import { ErrorNote, Loading, PersonBadge, Sheet, Toggle } from "../components/ui";
import { IconPlus, IconTrash, IconX } from "../components/Icons";

export const PERSON_COLORS = ["#c0392b", "#d35400", "#c49a1a", "#2e8b57", "#1f7a8c", "#3a6ea5", "#6c4fb0", "#b0417a", "#5d6d63"];
const EMOJI = ["🦊", "🐻", "🦄", "🐧", "🦖", "🐱", "🐶", "🐰", "🌟", "🎸", "⚽", "🎨"];
const SIZE_KEYS = ["shirt", "pants", "shoe", "dress", "jacket"];

export default function PersonFormPage() {
  const { id } = useParams();
  const people = usePeople(true);
  const navigate = useNavigate();
  const location = useLocation();
  const close = () => (location.key !== "default" ? navigate(-1) : navigate(id ? `/people/${id}` : "/people"));
  if (id && people.isLoading) {
    return (
      <Sheet title="Person" onClose={close}>
        <Loading />
      </Sheet>
    );
  }
  const person = id ? people.data?.find((p) => p.id === Number(id)) : undefined;
  if (id && !person) {
    return (
      <Sheet title="Person" onClose={close}>
        <ErrorNote error={people.error ?? new Error("This person doesn't exist.")} />
      </Sheet>
    );
  }
  return <PersonForm person={person} onClose={close} afterDelete={() => navigate("/people", { replace: true })} />;
}

function PersonForm({ person, onClose, afterDelete }: { person?: Person; onClose: () => void; afterDelete: () => void }) {
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  const isNew = !person;
  const [f, setF] = useState(() => ({
    name: person?.name ?? "",
    kind: person?.kind ?? ((sp.get("kind") as PersonKind) || "kid"),
    color: person?.color ?? PERSON_COLORS[Math.floor(Math.random() * PERSON_COLORS.length)],
    emoji: person?.emoji ?? "",
    birthday: person?.birthday ?? "",
    sizes: Object.entries(person?.sizes ?? {}) as [string, string][],
    likes: person?.likes ?? "",
    dislikes: person?.dislikes ?? "",
    notes: person?.notes ?? "",
    giverOnly: person?.giverOnly === true,
  }));
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const done = () => {
    qc.invalidateQueries({ queryKey: ["people"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const save = useMutation({
    mutationFn: (input: PersonInput) => (person ? api.people.update(person.id, input) : api.people.create(input as PersonInput & { name: string; kind: PersonKind })),
    onSuccess: () => {
      done();
      onClose();
    },
  });
  const archive = useMutation({
    mutationFn: () => api.people.remove(person!.id),
    onSuccess: () => {
      done();
      afterDelete();
    },
  });
  const unarchive = useMutation({
    mutationFn: () => api.people.update(person!.id, { archived: false }),
    onSuccess: () => {
      done();
      onClose();
    },
  });

  function submit(e?: FormEvent) {
    e?.preventDefault();
    setErr(null);
    if (!f.name.trim()) return setErr("Add a name.");
    const sizes: Record<string, string> = {};
    for (const [k, v] of f.sizes) if (k.trim() && v.trim()) sizes[k.trim()] = v.trim();
    save.mutate({
      name: f.name.trim(),
      kind: f.kind,
      color: f.color,
      emoji: f.emoji.trim(),
      birthday: f.birthday || null,
      sizes,
      likes: f.likes,
      dislikes: f.dislikes,
      notes: f.notes,
      giverOnly: f.giverOnly,
    });
  }

  const unusedKeys = SIZE_KEYS.filter((k) => !f.sizes.some(([sk]) => sk === k));

  return (
    <Sheet
      title={isNew ? "Add person" : `Edit ${person.name}`}
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          {!isNew &&
            (person.archived ? (
              <button type="button" className="btn-quiet" onClick={() => unarchive.mutate()} disabled={unarchive.isPending}>
                Unarchive
              </button>
            ) : (
              <button
                type="button"
                className="btn-danger !px-4"
                aria-label="Archive or delete person"
                disabled={archive.isPending}
                onClick={() =>
                  window.confirm(`Remove ${person.name}? If they have gifts they'll be archived (kept for history); otherwise deleted.`) && archive.mutate()
                }
              >
                <IconTrash size={20} />
              </button>
            ))}
          <button type="submit" form="person-form" className="btn-primary flex-1" disabled={save.isPending}>
            {save.isPending ? "Saving…" : isNew ? "Add person" : "Save changes"}
          </button>
        </div>
      }
    >
      <form id="person-form" onSubmit={submit} className="space-y-5" noValidate>
        <div className="flex items-center gap-4">
          <PersonBadge person={{ ...(person ?? ({} as Person)), name: f.name || "?", color: f.color, emoji: f.emoji }} size={64} />
          <div className="flex-1">
            <label htmlFor="pname" className="label">Name</label>
            <input id="pname" className="field text-[18px] font-semibold" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus={isNew} />
          </div>
        </div>

        <fieldset>
          <legend className="label">Who are they?</legend>
          <div className="flex gap-2">
            {(["kid", "parent", "other"] as PersonKind[]).map((k) => (
              <button key={k} type="button" className="chip flex-1 justify-center" aria-pressed={f.kind === k} onClick={() => set("kind", k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="card px-4">
          <Toggle
            checked={f.giverOnly}
            onChange={(v) => set("giverOnly", v)}
            label="Only gives gifts (a label like Santa)"
            hint="Shows up in “From”, never as a recipient or in budgets."
          />
        </div>

        <fieldset>
          <legend className="label">Color</legend>
          <div className="flex flex-wrap items-center gap-2">
            {PERSON_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                aria-pressed={f.color === c}
                onClick={() => set("color", c)}
                className="h-10 w-10 rounded-full transition-transform aria-pressed:scale-110"
                style={{ background: c, boxShadow: f.color === c ? `0 0 0 3px var(--surface), 0 0 0 5px ${c}` : undefined }}
              />
            ))}
            <label className="relative h-10 w-10 overflow-hidden rounded-full border border-dashed border-line" title="Custom color">
              <span className="sr-only">Custom color</span>
              <input type="color" value={f.color} onChange={(e) => set("color", e.target.value)} className="absolute -inset-2 h-14 w-14 cursor-pointer opacity-0" />
              <IconPlus size={18} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-muted" />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend className="label">Emoji</legend>
          <div className="flex flex-wrap items-center gap-2">
            {EMOJI.map((e) => (
              <button key={e} type="button" className="chip !px-2.5 text-[20px]" aria-pressed={f.emoji === e} onClick={() => set("emoji", f.emoji === e ? "" : e)}>
                {e}
              </button>
            ))}
            <input aria-label="Other emoji" className="field !min-h-[40px] w-20 text-center text-[20px]" value={EMOJI.includes(f.emoji) ? "" : f.emoji} onChange={(e) => set("emoji", e.target.value.slice(0, 8))} placeholder="…" />
          </div>
        </fieldset>

        <div>
          <label htmlFor="bday" className="label">Birthday</label>
          <input id="bday" type="date" className="field" value={f.birthday} onChange={(e) => set("birthday", e.target.value)} />
        </div>

        <fieldset>
          <legend className="label">Sizes</legend>
          <div className="space-y-2">
            {f.sizes.map(([k, v], i) => (
              <div key={i} className="flex gap-2">
                <input
                  aria-label="Size type"
                  className="field w-[40%]"
                  list="size-keys"
                  value={k}
                  placeholder="shirt"
                  onChange={(e) => set("sizes", f.sizes.map((row, j) => (j === i ? [e.target.value, row[1]] : row)))}
                />
                <input
                  aria-label={`${k || "Size"} value`}
                  className="field flex-1"
                  value={v}
                  placeholder="Youth M"
                  onChange={(e) => set("sizes", f.sizes.map((row, j) => (j === i ? [row[0], e.target.value] : row)))}
                />
                <button type="button" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2" aria-label="Remove size" onClick={() => set("sizes", f.sizes.filter((_, j) => j !== i))}>
                  <IconX size={20} />
                </button>
              </div>
            ))}
            <datalist id="size-keys">
              {SIZE_KEYS.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
            <div className="flex flex-wrap gap-2">
              {unusedKeys.map((k) => (
                <button key={k} type="button" className="chip" onClick={() => set("sizes", [...f.sizes, [k, ""]])}>
                  <IconPlus size={16} /> {k}
                </button>
              ))}
              <button type="button" className="chip" onClick={() => set("sizes", [...f.sizes, ["", ""]])}>
                <IconPlus size={16} /> Other
              </button>
            </div>
          </div>
        </fieldset>

        <div>
          <label htmlFor="likes" className="label">Likes</label>
          <textarea id="likes" className="field min-h-[80px]" value={f.likes} onChange={(e) => set("likes", e.target.value)} placeholder="Dinosaurs, anything purple, Bluey" />
        </div>
        <div>
          <label htmlFor="dislikes" className="label">Dislikes</label>
          <textarea id="dislikes" className="field min-h-[80px]" value={f.dislikes} onChange={(e) => set("dislikes", e.target.value)} placeholder="Scratchy sweaters" />
        </div>
        <div>
          <label htmlFor="notes" className="label">Notes</label>
          <textarea id="notes" className="field min-h-[96px]" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>

        {err && <p role="alert" className="rounded-xl bg-berry-soft px-4 py-3 text-[15px] font-medium text-berry">{err}</p>}
        <ErrorNote
          error={
            save.error instanceof ApiError && save.error.status === 409 && f.giverOnly
              ? new Error(`${f.name.trim() || "This person"} already has gifts, so they can't be giver-only. Move or delete those gifts first.`)
              : save.error || archive.error || unarchive.error
          }
        />
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}
