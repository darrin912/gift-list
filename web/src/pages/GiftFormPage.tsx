import { useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Gift, type GiftCategory, type GiftInput, type GiftStatus } from "../api";
import { ALL_STATUSES, CATEGORIES, CATEGORY_LABEL, centsToInput, isHttpUrl, parseDollars, STATUS_LABEL } from "../lib/format";
import { qk, useInvalidateGifts, usePeople, useStores } from "../lib/queries";
import { useSeason } from "../lib/season";
import { ErrorNote, Loading, Sheet, Toggle } from "../components/ui";
import { IconTrash } from "../components/Icons";

export default function GiftFormPage() {
  const { id } = useParams();
  const giftId = id ? Number(id) : undefined;
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: qk.gift(giftId ?? -1),
    queryFn: () => api.gifts.get(giftId!),
    enabled: giftId !== undefined,
    initialData: () => {
      if (giftId === undefined) return undefined;
      for (const [, list] of qc.getQueriesData<Gift[]>({ queryKey: ["gifts"] })) {
        const hit = list?.find((g) => g.id === giftId);
        if (hit) return hit;
      }
      return undefined;
    },
    staleTime: 0,
  });

  const close = useClose();

  if (giftId !== undefined && !q.data) {
    return (
      <Sheet title="Gift" onClose={close}>
        {q.isLoading ? <Loading /> : <ErrorNote error={q.error instanceof ApiError && q.error.status === 404 ? new Error("This gift doesn't exist, or it's a surprise for you.") : q.error} />}
      </Sheet>
    );
  }
  return <GiftForm key={giftId ?? "new"} gift={q.data} onDone={close} />;
}

function useClose() {
  const navigate = useNavigate();
  const location = useLocation();
  return () => (location.key !== "default" ? navigate(-1) : navigate("/gifts"));
}

const PRIORITIES: { v: 1 | 2 | 3; label: string }[] = [
  { v: 1, label: "High" },
  { v: 2, label: "Normal" },
  { v: 3, label: "Low" },
];

function GiftForm({ gift, onDone }: { gift: Gift | undefined; onDone: () => void }) {
  const [sp] = useSearchParams();
  const { seasons, seasonId: currentSeasonId } = useSeason();
  const people = usePeople();
  const stores = useStores();
  const invalidate = useInvalidateGifts();
  const isNew = !gift;

  const [f, setF] = useState(() => ({
    title: gift?.title ?? "",
    recipientId: gift?.recipientId ?? (sp.get("recipient") ? Number(sp.get("recipient")) : 0),
    seasonId: gift ? gift.seasonId : sp.get("inbox") ? null : (currentSeasonId ?? null),
    category: gift?.category ?? ("main" as GiftCategory),
    status: gift?.status ?? ("idea" as GiftStatus),
    wished: gift?.wished ?? false,
    priority: gift?.priority ?? (2 as 1 | 2 | 3),
    est: centsToInput(gift?.estPriceCents),
    actual: centsToInput(gift?.actualPriceCents),
    store: gift?.store ?? "",
    url: gift?.url ?? "",
    imageUrl: gift?.imageUrl ?? "",
    orderNumber: gift?.orderNumber ?? "",
    trackingUrl: gift?.trackingUrl ?? "",
    returnBy: gift?.returnBy ?? "",
    giverIds: gift?.giverIds ?? ([] as number[]),
    description: gift?.description ?? "",
  }));
  const [formError, setFormError] = useState<string | null>(null);
  const [imgOk, setImgOk] = useState(true);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const active = (people.data ?? []).filter((p) => !p.archived || p.id === f.recipientId || f.giverIds.includes(p.id));
  const parents = active.filter((p) => p.kind === "parent");
  const parentIds = parents.map((p) => p.id);
  const bothParents = parentIds.length === 2 && parentIds.every((id) => f.giverIds.includes(id)) && f.giverIds.length === 2;

  const save = useMutation({
    mutationFn: (input: GiftInput) =>
      gift ? api.gifts.update(gift.id, input) : api.gifts.create(input as GiftInput & { title: string; recipientId: number }),
    onSuccess: () => {
      invalidate();
      onDone();
    },
  });
  const del = useMutation({
    mutationFn: () => api.gifts.remove(gift!.id),
    onSuccess: () => {
      invalidate();
      onDone();
    },
  });

  function submit(e?: FormEvent) {
    e?.preventDefault();
    setFormError(null);
    const est = parseDollars(f.est);
    const actual = parseDollars(f.actual);
    if (!f.title.trim()) return setFormError("Add a title.");
    if (!f.recipientId) return setFormError("Choose who the gift is for.");
    if (Number.isNaN(est) || Number.isNaN(actual)) return setFormError("Enter prices in dollars, like 24.99.");
    for (const [label, v] of [
      ["Link", f.url],
      ["Image URL", f.imageUrl],
      ["Tracking link", f.trackingUrl],
    ] as const) {
      if (v.trim() && !isHttpUrl(v.trim())) return setFormError(`${label} must start with http:// or https://.`);
    }
    save.mutate({
      title: f.title.trim(),
      recipientId: f.recipientId,
      seasonId: f.seasonId,
      category: f.category,
      status: f.status,
      wished: f.wished,
      priority: f.priority,
      estPriceCents: est,
      actualPriceCents: actual,
      store: f.store.trim(),
      url: f.url.trim(),
      imageUrl: f.imageUrl.trim(),
      orderNumber: f.orderNumber.trim(),
      trackingUrl: f.trackingUrl.trim(),
      returnBy: f.returnBy || null,
      giverIds: f.giverIds,
      description: f.description,
    });
  }

  const toggleGiver = (id: number) =>
    set("giverIds", f.giverIds.includes(id) ? f.giverIds.filter((x) => x !== id) : [...f.giverIds, id]);

  return (
    <Sheet
      title={isNew ? "Add gift" : "Edit gift"}
      onClose={onDone}
      footer={
        <div className="flex gap-3">
          {!isNew && (
            <button
              type="button"
              className="btn-danger !px-4"
              aria-label="Delete gift"
              disabled={del.isPending}
              onClick={() => window.confirm(`Delete "${gift!.title}"? This can't be undone.`) && del.mutate()}
            >
              <IconTrash size={20} />
            </button>
          )}
          <button type="submit" form="gift-form" className="btn-primary flex-1" disabled={save.isPending}>
            {save.isPending ? "Saving…" : isNew ? "Add gift" : "Save changes"}
          </button>
        </div>
      }
    >
      <form id="gift-form" onSubmit={submit} className="space-y-5" noValidate>
        <Field label="What is it?" htmlFor="title">
          <input id="title" className="field text-[18px] font-semibold" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="LEGO tree house" autoFocus={isNew} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="For" htmlFor="recipient">
            <select id="recipient" className="field" value={f.recipientId || ""} onChange={(e) => set("recipientId", Number(e.target.value))}>
              <option value="">Choose…</option>
              {active.filter((p) => p.name !== "Santa").map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji ? `${p.emoji} ` : ""}
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Season" htmlFor="season">
            <select id="season" className="field" value={f.seasonId ?? "none"} onChange={(e) => set("seasonId", e.target.value === "none" ? null : Number(e.target.value))}>
              {seasons.filter((s) => !s.archived || s.id === f.seasonId).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="none">Ideas inbox</option>
            </select>
          </Field>
        </div>

        <fieldset>
          <legend className="label">From</legend>
          <div className="flex flex-wrap gap-2">
            {parents.length === 2 && (
              <button
                type="button"
                className="chip"
                aria-pressed={bothParents}
                onClick={() => set("giverIds", bothParents ? [] : parentIds)}
              >
                {parents.map((p) => p.name).join(" & ")}
              </button>
            )}
            {active.map((p) => (
              <button key={p.id} type="button" className="chip" aria-pressed={f.giverIds.includes(p.id)} onClick={() => toggleGiver(p.id)}>
                {p.emoji && <span aria-hidden="true">{p.emoji}</span>}
                {p.name}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="label">Status</legend>
          <div className="flex flex-wrap gap-2">
            {ALL_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                aria-pressed={f.status === s}
                onClick={() => set("status", s)}
                style={f.status === s ? { background: `var(--st-${s})`, borderColor: `var(--st-${s})`, color: "var(--surface)" } : undefined}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="label">Category</legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={f.category === c} onClick={() => set("category", c)}>
                {c === "stocking" && <span aria-hidden="true">🧦</span>}
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="card divide-y divide-line px-4">
          <Toggle checked={f.wished} onChange={(v) => set("wished", v)} label="Wished for" hint="They asked for this one" />
          <div className="flex min-h-[56px] items-center justify-between gap-3">
            <span className="font-semibold">Priority</span>
            <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
              {PRIORITIES.map((p) => (
                <button
                  key={p.v}
                  type="button"
                  aria-pressed={f.priority === p.v}
                  onClick={() => set("priority", p.v)}
                  className={`min-h-[38px] rounded-lg px-3 text-[14px] font-semibold ${f.priority === p.v ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Estimated price" htmlFor="est">
            <Money id="est" value={f.est} onChange={(v) => set("est", v)} />
          </Field>
          <Field label="Actual price" htmlFor="actual">
            <Money id="actual" value={f.actual} onChange={(v) => set("actual", v)} />
          </Field>
        </div>

        <Field label="Store" htmlFor="store">
          <input id="store" className="field" list="store-list" value={f.store} onChange={(e) => set("store", e.target.value)} placeholder="Target, Amazon…" autoComplete="off" />
          <datalist id="store-list">
            {(stores.data ?? []).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>

        <Field label="Link" htmlFor="url">
          <input id="url" className="field" type="url" inputMode="url" value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://" />
        </Field>

        <Field label="Image URL" htmlFor="img">
          <input
            id="img"
            className="field"
            type="url"
            inputMode="url"
            value={f.imageUrl}
            onChange={(e) => {
              set("imageUrl", e.target.value);
              setImgOk(true);
            }}
            placeholder="https://"
          />
          {f.imageUrl && isHttpUrl(f.imageUrl) && (
            <div className="mt-2 flex h-40 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface">
              {imgOk ? (
                <img src={f.imageUrl} alt="" className="h-full w-full object-contain" referrerPolicy="no-referrer" onError={() => setImgOk(false)} />
              ) : (
                <span className="text-[14px] text-muted">Can't load this image.</span>
              )}
            </div>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Order number" htmlFor="order">
            <input id="order" className="field" value={f.orderNumber} onChange={(e) => set("orderNumber", e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Return by" htmlFor="ret">
            <input id="ret" className="field" type="date" value={f.returnBy} onChange={(e) => set("returnBy", e.target.value)} />
          </Field>
        </div>

        <Field label="Tracking link" htmlFor="track">
          <input id="track" className="field" type="url" inputMode="url" value={f.trackingUrl} onChange={(e) => set("trackingUrl", e.target.value)} placeholder="https://" />
        </Field>

        <Field label="Notes" htmlFor="desc">
          <textarea id="desc" className="field min-h-[96px]" value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Color, size, where to hide it…" />
        </Field>

        {formError && <p role="alert" className="rounded-xl bg-berry-soft px-4 py-3 text-[15px] font-medium text-berry">{formError}</p>}
        <ErrorNote error={save.error || del.error} />
        {/* Lets Enter submit from text inputs on phones. */}
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

export function Money({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">$</span>
      <input id={id} className="field tnum pl-7" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0.00" autoComplete="off" />
    </div>
  );
}
