import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Gift, type GiftCategory, type GiftInput, type GiftStatus } from "../api";
import { ALL_STATUSES, CATEGORIES, CATEGORY_LABEL, centsToInput, formatCents, isGiverOnly, isHttpUrl, parseDollars, STATUS_LABEL } from "../lib/format";
import { looksLikeUrl, mergePreview } from "../lib/lists";
import { timeAgo } from "../lib/activity";
import { canCheckSimilar, groupSeasons, priceWatchInfo, similarHint, similarHintText } from "../lib/phase3";
import { qk, useDebounced, useInvalidateGifts, usePeople, useStores } from "../lib/queries";
import { useSeason } from "../lib/season";
import { ErrorNote, Loading, MarkdownHint, Sheet, Toggle } from "../components/ui";
import { IconSparkle, IconTrash } from "../components/Icons";

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
  // A new gift defaults to the selected season, so wait for the seasons to load
  // (otherwise a cold load of /gifts/new would silently file it in the ideas inbox).
  const { isLoading: seasonsLoading } = useSeason();

  if (giftId === undefined && seasonsLoading) {
    return (
      <Sheet title="Add gift" onClose={close}>
        <Loading />
      </Sheet>
    );
  }
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
    giverIds:
      gift?.giverIds ??
      (sp.get("from")
        ? sp
            .get("from")!
            .split(",")
            .map(Number)
            .filter((n) => Number.isInteger(n) && n > 0)
        : ([] as number[])),
    description: gift?.description ?? "",
    watchPrice: gift?.watchPrice ?? false,
  }));
  const [formError, setFormError] = useState<string | null>(null);
  const [imgOk, setImgOk] = useState(true);
  const [preview, setPreview] = useState<{ kind: "ok" | "blocked" | "empty" | "error"; text: string } | null>(null);
  // Always merge into the latest form values (the request may finish after more typing).
  const latest = useRef(f);
  latest.current = f;
  const autofill = useMutation({
    mutationFn: (url: string) => api.linkPreview(url),
    onMutate: () => setPreview(null),
    onSuccess: (p) => {
      const { next, filled } = mergePreview(latest.current, p, centsToInput);
      setF(next);
      if (filled.includes("imageUrl")) setImgOk(true);
      const names: Record<string, string> = { title: "title", imageUrl: "image", est: "price", store: "store" };
      const list = filled.map((k) => names[k]).join(", ");
      if (p.blocked)
        setPreview({ kind: "blocked", text: `This store didn't let us peek at the page${filled.length ? ` (we filled in the ${list})` : ""}. Fill in the rest by hand.` });
      else if (filled.length) setPreview({ kind: "ok", text: `Filled in the ${list}. Check it looks right.` });
      else setPreview({ kind: "empty", text: "Nothing new to fill in from that page." });
    },
    onError: (e) => setPreview({ kind: "error", text: e instanceof ApiError && e.status === 400 ? "That link can't be previewed." : e instanceof ApiError && e.status === 429 ? "Too many previews in a minute. Try again shortly." : "Couldn't reach that page right now." }),
  });
  const runAutofill = (url: string) => {
    const u = url.trim();
    if (!isHttpUrl(u)) return setPreview({ kind: "error", text: "Paste a link that starts with http:// or https://." });
    autofill.mutate(u);
  };
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
      // Watching needs a link; clearing the link turns the watch off.
      watchPrice: f.watchPrice && isHttpUrl(f.url.trim()),
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
          <input
            id="title"
            className="field text-[18px] font-semibold"
            value={f.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="LEGO tree house"
            autoFocus={isNew}
            aria-describedby="similar-hint"
          />
          <GivenBefore recipientId={f.recipientId} title={f.title} excludeId={gift?.id} recipientName={people.data?.find((p) => p.id === f.recipientId)?.name ?? ""} />
        </Field>

        <Field label="Link" htmlFor="url">
          <div className="flex gap-2">
            <input
              id="url"
              className="field min-w-0 flex-1"
              type="url"
              inputMode="url"
              value={f.url}
              onChange={(e) => set("url", e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (looksLikeUrl(text) && !f.url.trim()) {
                  // Let the paste land in the field, then fetch the preview.
                  setTimeout(() => runAutofill(text), 0);
                }
              }}
              placeholder="Paste a product link"
            />
            <button
              type="button"
              className="btn-quiet shrink-0 !px-3.5"
              onClick={() => runAutofill(f.url)}
              disabled={autofill.isPending || !f.url.trim()}
              aria-describedby={preview ? "autofill-note" : undefined}
            >
              <IconSparkle size={18} className={autofill.isPending ? "animate-pulse" : ""} />
              {autofill.isPending ? "Looking…" : "Auto-fill"}
            </button>
          </div>
          {preview ? (
            <p
              id="autofill-note"
              role="status"
              className={`mt-2 rounded-xl px-3 py-2 text-[14px] ${
                preview.kind === "ok" ? "bg-pine-soft text-pine" : preview.kind === "error" ? "bg-berry-soft text-berry" : "bg-gold-soft text-gold"
              }`}
            >
              {preview.text}
            </p>
          ) : (
            <p className="mt-1.5 text-[13px] text-muted">Paste a link and we'll try to fill in the title, picture, price, and store (only the empty ones).</p>
          )}
          {isHttpUrl(f.url.trim()) && (
            <div className="card mt-3 px-4">
              <Toggle checked={f.watchPrice} onChange={(v) => set("watchPrice", v)} label="Watch price" hint="We check this link once a day and flag drops." />
              {gift?.url && <PriceCheck gift={gift} linkChanged={f.url.trim() !== gift.url} />}
            </div>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="For" htmlFor="recipient">
            <select id="recipient" className="field" value={f.recipientId || ""} onChange={(e) => set("recipientId", Number(e.target.value))}>
              <option value="">Choose…</option>
              {active.filter((p) => !isGiverOnly(p) || p.id === f.recipientId).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji ? `${p.emoji} ` : ""}
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Season" htmlFor="season">
            <select id="season" className="field" value={f.seasonId ?? "none"} onChange={(e) => set("seasonId", e.target.value === "none" ? null : Number(e.target.value))}>
              {groupSeasons(seasons.filter((s) => !s.archived || s.id === f.seasonId)).map((g) => (
                <optgroup key={g.key} label={g.label}>
                  {g.seasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
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
          <MarkdownHint />
        </Field>

        {formError && <p role="alert" className="rounded-xl bg-berry-soft px-4 py-3 text-[15px] font-medium text-berry">{formError}</p>}
        <ErrorNote error={save.error || del.error} />
        {/* Lets Enter submit from text inputs on phones. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}

/** "🔁 Looks like Ava got LEGO Set in Christmas 2025", checked as you type (debounced). */
function GivenBefore({ recipientId, title, excludeId, recipientName }: { recipientId: number; title: string; excludeId?: number; recipientName: string }) {
  const t = useDebounced(title.trim(), 450);
  const enabled = recipientId > 0 && canCheckSimilar(t);
  const q = useQuery({
    queryKey: qk.similar(recipientId, t, excludeId),
    queryFn: () => api.gifts.similar({ recipientId, title: t, excludeId }),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  const items = enabled ? (q.data ?? []) : [];
  const h = similarHint(items, recipientName);
  return (
    <div id="similar-hint" aria-live="polite">
      {h && (
        <p className="mt-2 flex gap-2 rounded-xl bg-gold-soft px-3 py-2 text-[14px] leading-snug text-ink" aria-label={similarHintText(items, recipientName)}>
          <span aria-hidden="true">🔁</span>
          <span>
            {h.lead} <i className="font-semibold">{h.title}</i> {h.where}
            {h.more && <span className="text-muted"> {h.more}</span>}
          </span>
        </p>
      )}
    </div>
  );
}

/** Last check, lowest price, and an on-demand "Check now" for a saved gift's link. */
function PriceCheck({ gift, linkChanged }: { gift: Gift; linkChanged: boolean }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateGifts();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [g, setG] = useState(gift);
  const check = useMutation({
    mutationFn: () => api.gifts.checkPrice(gift.id),
    onMutate: () => setMsg(null),
    onSuccess: (next) => {
      setG(next);
      qc.setQueryData(qk.gift(gift.id), next);
      invalidate();
      const dropped = !!next.priceDroppedAt && next.priceDroppedAt !== gift.priceDroppedAt;
      if (dropped && next.lastSeenPriceCents != null) setMsg({ ok: true, text: `⬇ Price dropped to ${formatCents(next.lastSeenPriceCents)}!` });
      else if (next.lastSeenPriceCents != null) setMsg({ ok: true, text: `It's ${formatCents(next.lastSeenPriceCents)} right now.` });
      else setMsg({ ok: false, text: "Couldn't find a price on that page right now." });
    },
    onError: (e) =>
      setMsg({ ok: false, text: e instanceof ApiError && e.status === 429 ? "That's a lot of checks. Try again in a minute." : e instanceof ApiError ? e.message : "Couldn't reach that page right now." }),
  });
  const info = priceWatchInfo({ ...g, watchPrice: true });
  const meta = [
    g.lastCheckedAt ? `Checked ${timeAgo(g.lastCheckedAt)}` : "Not checked yet",
    g.lastSeenPriceCents != null ? `last ${formatCents(g.lastSeenPriceCents)}` : null,
    info.lowest,
  ].filter(Boolean);
  return (
    <div className="border-t border-line py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-[14px] text-muted">
          {info.dropped && <div className="mb-1"><span className="inline-flex rounded-full bg-pine-soft px-2 py-0.5 text-[13px] font-semibold text-pine">⬇ Price drop</span></div>}
          <span className="tnum">{meta.join(" · ")}</span>
        </div>
        <button type="button" className="btn-quiet min-h-[40px] shrink-0 !px-3.5 text-[15px]" onClick={() => check.mutate()} disabled={check.isPending}>
          {check.isPending ? "Checking…" : "Check now"}
        </button>
      </div>
      {linkChanged && <p className="mt-1 text-[13px] text-muted">Checks the saved link. Save first to check the new one.</p>}
      {msg && (
        <p role="status" className={`mt-2 rounded-xl px-3 py-2 text-[14px] ${msg.ok ? "bg-pine-soft text-pine" : "bg-gold-soft text-gold"}`}>
          {msg.text}
        </p>
      )}
    </div>
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
