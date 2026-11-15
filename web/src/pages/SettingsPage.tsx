import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { api, exportCsvUrl, type ImportResult, type Person, type Season, type SeasonInput, type SeasonKind } from "../api";
import { allocation, centsToInput, formatCents, formatDate, parseDollars, recipientsOf, SEASON_KIND_LABEL } from "../lib/format";
import { csvDataRowCount, orderImportRows, parseImportTarget, plural, summarizeImport } from "../lib/csv";
import { applyTheme, readThemePref, storeThemePref, type ThemePref } from "../lib/theme";
import { qk, useBudgets, useMe, usePasskeys, usePeople, usePeopleMap } from "../lib/queries";
import { birthdaySeasonName, defaultDeviceName, nextBirthday, passkeyError, supportsPasskeys } from "../lib/phase3";
import { useSeason } from "../lib/season";
import { AllocationLine, ErrorNote, Loading, PageHeader, PersonBadge, Toggle } from "../components/ui";
import { IconCheck, IconDownload, IconLogout, IconPlus, IconTrash, IconUpload, IconX } from "../components/Icons";
import { timeAgo } from "../lib/activity";
import { Money } from "./GiftFormPage";

export default function SettingsPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
        <div className="space-y-6">
          <Seasons />
          <Budgets />
        </div>
        <div className="space-y-6">
          <Theme />
          <ExportCsv />
          <ImportCsv />
          <Security />
          <Password />
          <Account />
        </div>
      </div>
    </>
  );
}

function Section({ id, title, sub, children, right }: { id?: string; title: string; sub?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-20 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-bold">{title}</h2>
          {sub && <p className="text-[14px] text-muted">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Seasons() {
  const { seasons, isLoading } = useSeason();
  const peopleMap = usePeopleMap();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  useEffect(() => {
    if (!isLoading && seasons.length === 0) setEditing("new");
  }, [isLoading, seasons.length]);
  return (
    <Section
      id="seasons"
      title="Seasons"
      sub="Each occasion keeps its own gifts and budget."
      right={
        editing !== "new" && (
          <button type="button" className="chip" onClick={() => setEditing("new")}>
            <IconPlus size={16} /> New
          </button>
        )
      }
    >
      {editing === "new" && <SeasonForm onDone={() => setEditing(null)} />}
      <ul className="divide-y divide-line">
        {seasons.map((s) =>
          editing === s.id ? (
            <li key={s.id} className="py-3">
              <SeasonForm season={s} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={s.id}>
              <button type="button" onClick={() => setEditing(s.id)} className={`flex min-h-[60px] w-full items-center gap-3 py-2 text-left ${s.archived ? "opacity-60" : ""}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{s.name}</span>
                  <span className="tnum block text-[14px] text-muted">
                    {[
                      s.honoreeId && peopleMap.get(s.honoreeId) ? `${SEASON_KIND_LABEL[s.kind]} · ${peopleMap.get(s.honoreeId)!.name}` : SEASON_KIND_LABEL[s.kind],
                      s.date ? formatDate(s.date) : null,
                      `${formatCents(s.overallBudgetCents, { round: true })} budget`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {s.isActive && <span className="rounded-full bg-pine-soft px-2.5 py-0.5 text-[13px] font-semibold text-pine">Active</span>}
                {s.archived && <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[13px] font-semibold text-muted">Archived</span>}
              </button>
            </li>
          ),
        )}
      </ul>
    </Section>
  );
}

function SeasonForm({ season, onDone }: { season?: Season; onDone: () => void }) {
  const qc = useQueryClient();
  const { setSeasonId, seasons } = useSeason();
  const people = usePeople();
  const honorees = recipientsOf(people.data ?? []);
  const year = new Date().getFullYear();
  const [f, setF] = useState({
    name: season?.name ?? `Christmas ${year}`,
    kind: season?.kind ?? ("christmas" as SeasonKind),
    date: season?.date ?? `${year}-12-25`,
    budget: centsToInput(season?.overallBudgetCents ?? null),
    isActive: season?.isActive ?? seasons.length === 0,
    archived: season?.archived ?? false,
    honoreeId: season?.honoreeId ?? (null as number | null),
  });
  // New seasons get a suggested name and date until the name is typed over.
  const [nameTouched, setNameTouched] = useState(!!season);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const suggest = (kind: SeasonKind, honoreeId: number | null) => {
    const next = { ...f, kind, honoreeId: kind === "birthday" || kind === "anniversary" ? honoreeId : null };
    if (!season) {
      const person = honorees.find((p) => p.id === next.honoreeId);
      const nb = person ? nextBirthday(person.birthday) : null;
      if (kind === "christmas") {
        if (!nameTouched) next.name = `Christmas ${year}`;
        next.date = `${year}-12-25`;
      } else if (kind === "birthday") {
        if (person && nb) next.date = nb.date;
        if (!nameTouched) next.name = person ? birthdaySeasonName(person.name, nb?.date ?? `${year}`) : "";
      } else if (kind === "anniversary" && !nameTouched) next.name = `Anniversary ${year}`;
      else if (!nameTouched && f.kind !== kind) next.name = "";
    }
    setF(next);
  };
  const honoree = honorees.find((p) => p.id === f.honoreeId);

  const save = useMutation({
    mutationFn: (input: SeasonInput) => (season ? api.seasons.update(season.id, input) : api.seasons.create(input as SeasonInput & { name: string; kind: SeasonKind })),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: qk.seasons });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (!season && s?.id) setSeasonId(s.id);
      onDone();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseDollars(f.budget) ?? 0;
    if (f.kind === "birthday" && !f.honoreeId) return setErr("Choose whose birthday it is.");
    if (!f.name.trim()) return setErr("Add a name.");
    if (!f.date) return setErr("Add the date of the occasion.");
    if (Number.isNaN(cents)) return setErr("Enter the budget in dollars, like 1500.");
    setErr(null);
    save.mutate({
      name: f.name.trim(),
      kind: f.kind,
      date: f.date,
      overallBudgetCents: cents,
      isActive: f.isActive,
      archived: f.archived,
      honoreeId: f.kind === "birthday" || f.kind === "anniversary" ? f.honoreeId : null,
    });
  }

  return (
    <form onSubmit={submit} className="mb-3 space-y-3 rounded-xl bg-surface-2 p-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`sk${season?.id ?? "new"}`} className="label">Occasion</label>
          <select id={`sk${season?.id ?? "new"}`} className="field" value={f.kind} onChange={(e) => suggest(e.target.value as SeasonKind, f.honoreeId)}>
            {(Object.keys(SEASON_KIND_LABEL) as SeasonKind[]).map((k) => (
              <option key={k} value={k}>{SEASON_KIND_LABEL[k]}</option>
            ))}
          </select>
        </div>
        {(f.kind === "birthday" || f.kind === "anniversary") && (
          <div>
            <label htmlFor={`sh${season?.id ?? "new"}`} className="label">{f.kind === "birthday" ? "Whose birthday?" : "For"}</label>
            <select
              id={`sh${season?.id ?? "new"}`}
              className="field"
              value={f.honoreeId ?? ""}
              onChange={(e) => suggest(f.kind, e.target.value ? Number(e.target.value) : null)}
              aria-invalid={f.kind === "birthday" && !f.honoreeId && !!err}
            >
              <option value="">{f.kind === "birthday" ? "Choose…" : "Both of us"}</option>
              {honorees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji ? `${p.emoji} ` : ""}
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {f.kind === "birthday" && honoree && !honoree.birthday && (
        <p className="-mt-1 text-[13px] text-muted">No birthday saved for {honoree.name}, so pick the date below.</p>
      )}
      <div>
        <label htmlFor={`sn${season?.id ?? "new"}`} className="label">Name</label>
        <input
          id={`sn${season?.id ?? "new"}`}
          className="field"
          value={f.name}
          onChange={(e) => {
            setNameTouched(true);
            set("name", e.target.value);
          }}
          placeholder={f.kind === "birthday" ? "Ava's Birthday 2027" : undefined}
        />
      </div>
      <div>
        <label htmlFor={`sd${season?.id ?? "new"}`} className="label">Date</label>
        <input id={`sd${season?.id ?? "new"}`} type="date" className="field" value={f.date} onChange={(e) => set("date", e.target.value)} />
      </div>
      <div>
        <label htmlFor={`sb${season?.id ?? "new"}`} className="label">Overall budget</label>
        <Money id={`sb${season?.id ?? "new"}`} value={f.budget} onChange={(v) => set("budget", v)} />
      </div>
      <Toggle checked={f.isActive} onChange={(v) => set("isActive", v)} label="Active season" hint="Opens by default. Only one can be active." />
      {season && <Toggle checked={f.archived} onChange={(v) => set("archived", v)} label="Archived" hint="Archiving also reveals hidden surprises." />}
      {err && <p className="text-[14px] font-medium text-berry">{err}</p>}
      <ErrorNote error={save.error} />
      <div className="flex gap-2">
        <button type="button" className="btn-quiet flex-1" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn-primary flex-1" disabled={save.isPending}>{season ? "Save season" : "Create season"}</button>
      </div>
    </form>
  );
}

function Budgets() {
  const { season } = useSeason();
  const people = usePeople();
  const budgets = useBudgets(season?.id);
  // Live drafts of the gift budget inputs, so the allocation summary updates while typing.
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const onDraft = useCallback((key: string, cents: number) => setDrafts((d) => (d[key] === cents ? d : { ...d, [key]: cents })), []);
  if (!season) return null;
  const list = recipientsOf(people.data ?? []);
  const alloc = allocation(
    season.overallBudgetCents,
    list.map((p) => drafts[`${season.id}-${p.id}`] ?? budgets.data?.find((b) => b.personId === p.id)?.budgetCents ?? 0),
  );
  return (
    <Section id="budgets" title="Budgets" sub={`Per person for ${season.name}. Saves when you leave a field.`}>
      <ErrorNote error={budgets.error} />
      {budgets.isLoading ? (
        <Loading />
      ) : (
        <>
          <AllocationLine allocated={alloc.allocatedCents} unallocated={alloc.unallocatedCents} overall={season.overallBudgetCents} className="mb-4" />
          <div className="grid grid-cols-[1fr_6.5rem_6.5rem] items-center gap-x-2 gap-y-2">
            <span />
            <span className="text-[13px] font-semibold text-muted">Gifts</span>
            <span className="text-[13px] font-semibold text-muted">🧦 Stocking</span>
            {list.map((p) => {
              const row = budgets.data?.find((b) => b.personId === p.id);
              // Keyed by season + person only: keying on the saved values remounted the row after
              // every save, wiping whatever was being typed in the other field of that row.
              const key = `${season.id}-${p.id}`;
              return <BudgetRow key={key} draftKey={key} onDraft={onDraft} seasonId={season.id} person={p} budget={row?.budgetCents ?? 0} stocking={row?.stockingBudgetCents ?? 0} />;
            })}
          </div>
        </>
      )}
    </Section>
  );
}

function BudgetRow({
  seasonId,
  person,
  budget,
  stocking,
  draftKey,
  onDraft,
}: {
  seasonId: number;
  person: Person;
  budget: number;
  stocking: number;
  draftKey: string;
  onDraft: (key: string, cents: number) => void;
}) {
  const qc = useQueryClient();
  const [b, setB] = useState(centsToInput(budget || null));
  useEffect(() => {
    const c = parseDollars(b);
    if (!Number.isNaN(c)) onDraft(draftKey, c ?? 0);
  }, [b, draftKey, onDraft]);
  const [s, setS] = useState(centsToInput(stocking || null));
  const save = useMutation({
    mutationFn: (v: { budgetCents: number; stockingBudgetCents: number }) => api.seasons.setBudget(seasonId, person.id, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets", seasonId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const commit = () => {
    const bc = parseDollars(b) ?? 0;
    const sc = parseDollars(s) ?? 0;
    if (Number.isNaN(bc) || Number.isNaN(sc)) return;
    if (bc === budget && sc === stocking) return;
    save.mutate({ budgetCents: bc, stockingBudgetCents: sc });
  };
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <PersonBadge person={person} size={28} />
        <span className="truncate font-semibold">{person.name}</span>
        {save.isError && <span className="text-[12px] text-berry">Not saved</span>}
      </span>
      <div onBlur={commit}>
        <Money id={`b${person.id}`} value={b} onChange={setB} />
      </div>
      <div onBlur={commit}>
        <Money id={`s${person.id}`} value={s} onChange={setS} />
      </div>
    </>
  );
}

/** Passkeys (Face ID / Touch ID): add one for this device, see and remove the rest. */
function Security() {
  const qc = useQueryClient();
  const list = usePasskeys();
  const supported = supportsPasskeys();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(() => defaultDeviceName(typeof navigator !== "undefined" ? navigator.userAgent : ""));
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const add = useMutation({
    mutationFn: async () => {
      const optionsJSON = (await api.auth.passkeyRegisterOptions()) as PublicKeyCredentialCreationOptionsJSON;
      const response = await startRegistration({ optionsJSON });
      return api.auth.passkeyRegisterVerify(response, name.trim() || "Passkey");
    },
    onMutate: () => setNote(null),
    onSuccess: () => {
      setNote({ ok: true, text: `Added “${name.trim() || "Passkey"}”. Next time, sign in with Face ID or your device.` });
      setAdding(false);
      qc.invalidateQueries({ queryKey: qk.passkeys });
    },
    onError: (e) => {
      const err = passkeyError(e, "register");
      setNote({ ok: false, text: err.message });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.auth.removePasskey(id),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.passkeys }),
  });

  const keys = list.data ?? [];
  return (
    <Section id="security" title="Security" sub="Passkeys let you sign in with Face ID, Touch ID, or your phone's lock. Your password keeps working.">
      {list.isLoading ? (
        <Loading />
      ) : (
        <>
          <ErrorNote error={list.error || remove.error} />
          {keys.length > 0 && (
            <ul className="mb-4 divide-y divide-line rounded-xl border border-line">
              {keys.map((k) => (
                <li key={k.id} className="flex min-h-[60px] items-center gap-3 py-2 pl-3.5 pr-1.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pine-soft text-[18px]" aria-hidden="true">🔑</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{k.name || "Passkey"}</span>
                    <span className="block truncate text-[13px] text-muted">
                      Added {formatDate(k.createdAt.slice(0, 10))}
                      {k.lastUsedAt ? ` · last used ${timeAgo(k.lastUsedAt)}` : " · not used yet"}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-berry-soft hover:text-berry"
                    aria-label={`Remove passkey ${k.name}`}
                    disabled={remove.isPending}
                    onClick={() => window.confirm(`Remove the passkey “${k.name}”? You can still sign in with your password.`) && remove.mutate(k.id)}
                  >
                    <IconTrash size={19} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {note && (
            <p role="status" className={`mb-3 rounded-xl px-4 py-3 text-[15px] font-medium ${note.ok ? "bg-pine-soft text-pine" : "bg-gold-soft text-gold"}`}>
              {note.text}
            </p>
          )}
          {!supported ? (
            <p className="rounded-xl bg-surface-2 px-4 py-3 text-[14px] text-muted">This browser doesn't support passkeys. Try Safari on an iPhone, or a recent Chrome.</p>
          ) : adding ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              <div>
                <label htmlFor="pk-name" className="label">Name this device</label>
                <input id="pk-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-quiet flex-1" onClick={() => setAdding(false)}>Cancel</button>
                <button type="submit" className="btn-primary flex-[2]" disabled={add.isPending}>
                  {add.isPending ? "Waiting for device…" : "Continue"}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className={keys.length ? "btn-quiet w-full" : "btn-primary w-full"}
              onClick={() => {
                setNote(null);
                setAdding(true);
              }}
            >
              <IconPlus size={20} /> Add a passkey
            </button>
          )}
        </>
      )}
    </Section>
  );
}

function Password() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => api.auth.changePassword(cur, next),
    onSuccess: () => {
      setCur("");
      setNext("");
      setConfirm("");
    },
  });
  return (
    <Section title="Change password">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          change.reset();
          if (next.length < 10) return setErr("Use at least 10 characters for the new password.");
          if (next !== confirm) return setErr("The new passwords don't match.");
          setErr(null);
          change.mutate();
        }}
        noValidate
      >
        <input type="text" autoComplete="username" className="hidden" aria-hidden="true" tabIndex={-1} readOnly />
        <div>
          <label htmlFor="cur" className="label">Current password</label>
          <input id="cur" type="password" className="field" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </div>
        <div>
          <label htmlFor="new" className="label">New password</label>
          <input id="new" type="password" className="field" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <p className="mt-1 text-[13px] text-muted">At least 10 characters.</p>
        </div>
        <div>
          <label htmlFor="confirm" className="label">Confirm new password</label>
          <input id="confirm" type="password" className="field" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {err && <p className="text-[14px] font-medium text-berry">{err}</p>}
        <ErrorNote error={change.error} />
        {change.isSuccess && <p role="status" className="rounded-xl bg-pine-soft px-4 py-3 text-[15px] font-medium text-pine">Password changed.</p>}
        <button type="submit" className="btn-primary w-full" disabled={change.isPending || !cur || !next}>
          {change.isPending ? "Changing…" : "Change password"}
        </button>
      </form>
    </Section>
  );
}

function Account() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: api.auth.logout,
    onSettled: () => {
      qc.clear();
      navigate("/login", { replace: true });
    },
  });
  return (
    <Section title="Account">
      <p className="mb-4 text-muted">
        Signed in as <b className="text-ink">{me.data?.displayName}</b>
      </p>
      <button type="button" className="btn-quiet w-full" onClick={() => logout.mutate()} disabled={logout.isPending}>
        <IconLogout size={20} /> Sign out
      </button>
    </Section>
  );
}

const THEMES: { v: ThemePref; label: string; swatch: [string, string, string] }[] = [
  { v: "system", label: "System", swatch: ["#f3f6f2", "#0d1613", "#1f5c45"] },
  { v: "light", label: "Light", swatch: ["#f3f6f2", "#ffffff", "#1f5c45"] },
  { v: "dark", label: "Dark", swatch: ["#0d1613", "#15211c", "#6cc79e"] },
  { v: "holiday", label: "Holiday", swatch: ["#f8f1e6", "#8a1a2b", "#1b5a3c"] },
];

function Theme() {
  const [pref, setPref] = useState<ThemePref>(readThemePref);
  const choose = (v: ThemePref) => {
    setPref(v);
    storeThemePref(v);
    applyTheme(v);
  };
  return (
    <Section id="theme" title="Theme" sub="Saved on this device.">
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => {
          const on = pref === t.v;
          return (
            <button
              key={t.v}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => choose(t.v)}
              className={`flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-xl border-2 px-1 text-[14px] font-semibold transition-colors ${on ? "border-pine bg-pine-soft text-ink" : "border-line text-muted"}`}
            >
              <span className="relative flex h-9 w-9 overflow-hidden rounded-full ring-1 ring-line" aria-hidden="true">
                {t.v === "system" ? (
                  <>
                    <span className="h-full w-1/2" style={{ background: t.swatch[0] }} />
                    <span className="h-full w-1/2" style={{ background: t.swatch[1] }} />
                  </>
                ) : (
                  <span className="h-full w-full" style={{ background: t.swatch[0] }} />
                )}
                <span className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full" style={{ background: t.swatch[2], boxShadow: `0 0 0 2px ${t.v === "holiday" ? t.swatch[1] : "transparent"}` }} />
              </span>
              {t.label}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function ExportCsv() {
  const { season } = useSeason();
  const [picked, setScope] = useState<"season" | "all" | null>(null);
  const scope = picked ?? (season ? "season" : "all");
  const href = exportCsvUrl(scope === "season" && season ? season.id : undefined);
  return (
    <Section id="export" title="Export to CSV" sub="A spreadsheet of your gifts. Surprises for you are left out.">
      <div className="mb-3 flex gap-1 rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="What to export">
        {(
          [
            ["season", season?.name ?? "This season"],
            ["all", "Every gift"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={scope === v}
            disabled={v === "season" && !season}
            onClick={() => setScope(v)}
            className={`min-h-[40px] min-w-0 flex-1 truncate rounded-lg px-2 text-[15px] font-semibold transition-colors ${scope === v ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <a href={href} download className="btn-quiet w-full">
        <IconDownload size={20} /> Download CSV
      </a>
    </Section>
  );
}

function ImportCsv() {
  const { seasons, season } = useSeason();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [pickedTarget, setTarget] = useState<string | null>(null);
  const target = pickedTarget ?? (season && !season.archived ? String(season.id) : "inbox");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);

  const reset = () => {
    setPreview(null);
    setDone(null);
  };
  const dry = useMutation({
    mutationFn: () => api.importCsv({ csv, seasonId: parseImportTarget(target), dryRun: true }),
    onSuccess: (r) => setPreview(r),
  });
  const run = useMutation({
    mutationFn: () => api.importCsv({ csv, seasonId: parseImportTarget(target), dryRun: false }),
    onSuccess: (r) => {
      setDone(r);
      setPreview(null);
      setCsv("");
      setFileName(null);
      ["gifts", "dashboard", "activity", "stores"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReadErr(null);
    reset();
    try {
      setCsv(await file.text());
      setFileName(file.name);
    } catch {
      setReadErr("Couldn't read that file.");
    }
  };

  const rowsGuess = csv.trim() ? csvDataRowCount(csv) : 0;
  const sum = preview ? summarizeImport(preview.rows) : null;
  const targetName = target === "inbox" ? "the ideas inbox" : (seasons.find((s) => String(s.id) === target)?.name ?? "the season");

  return (
    <Section id="import" title="Import from CSV" sub="Columns like the export. Only title and recipient are required; names must match people.">
      <div className="space-y-3">
        <div className="flex gap-2">
          <button type="button" className="btn-quiet flex-1" onClick={() => fileRef.current?.click()}>
            <IconUpload size={20} /> Choose file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        <div>
          <label htmlFor="csv-text" className="label">
            {fileName ? `From ${fileName}` : "…or paste CSV"}
          </label>
          <textarea
            id="csv-text"
            className="field min-h-[110px] font-mono text-[13px] leading-snug"
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setFileName(null);
              reset();
            }}
            placeholder={"recipient,title,est_price,store\nEmma,Art easel,45,Target"}
            spellCheck={false}
          />
          {rowsGuess > 0 && <p className="tnum mt-1 text-[13px] text-muted">About {plural(rowsGuess, "row")}.</p>}
        </div>
        <div>
          <label htmlFor="csv-target" className="label">Import into</label>
          <select
            id="csv-target"
            className="field"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              reset();
            }}
          >
            {seasons
              .filter((s) => !s.archived)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            <option value="inbox">Ideas inbox (no season)</option>
          </select>
        </div>
        {readErr && <p className="text-[14px] font-medium text-berry">{readErr}</p>}
        <ErrorNote error={dry.error || run.error} />
        {done && (
          <div role="status" className="space-y-2">
            <p className="rounded-xl bg-pine-soft px-4 py-3 text-[15px] font-medium text-pine">
              Imported {plural(done.created, "gift")} into {targetName}.
            </p>
            {done.rows.some((r) => !r.ok) && (
              <>
                <p className="text-[14px] font-semibold text-berry">Skipped {plural(done.rows.filter((r) => !r.ok).length, "row")}:</p>
                <ImportPreviewTable result={{ created: done.created, rows: done.rows.filter((r) => !r.ok) }} />
              </>
            )}
          </div>
        )}
        {!preview ? (
          <button type="button" className="btn-primary w-full" disabled={!csv.trim() || dry.isPending} onClick={() => dry.mutate()}>
            {dry.isPending ? "Checking…" : "Preview import"}
          </button>
        ) : (
          <>
            <p className="tnum text-[15px]">
              <b>{plural(sum!.ok, "row")}</b> ready
              {sum!.errors > 0 && (
                <>
                  {" · "}
                  <b className="text-berry">{plural(sum!.errors, "row")} with problems</b>
                  <span className="text-muted"> (won't be imported)</span>
                </>
              )}
            </p>
            <ImportPreviewTable result={preview} />
            <div className="flex gap-2">
              <button type="button" className="btn-quiet flex-1" onClick={reset}>
                Cancel
              </button>
              <button type="button" className="btn-primary flex-[2]" disabled={sum!.ok === 0 || run.isPending} onClick={() => run.mutate()}>
                {run.isPending ? "Importing…" : `Import ${plural(sum!.ok, "gift")}`}
              </button>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}

function ImportPreviewTable({ result }: { result: ImportResult }) {
  const rows = orderImportRows(result.rows);
  return (
    <div className="max-h-72 overflow-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-left text-[14px]">
        <thead className="sticky top-0 bg-surface-2">
          <tr>
            <th scope="col" className="px-2.5 py-2 font-semibold text-muted">Line</th>
            <th scope="col" className="px-2.5 py-2 font-semibold text-muted">Gift</th>
            <th scope="col" className="px-2.5 py-2 font-semibold text-muted">For</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.line} className={`border-t border-line align-top ${r.ok ? "" : "bg-berry-soft"}`}>
              <td className="tnum whitespace-nowrap px-2.5 py-2">
                <span className="inline-flex items-center gap-1">
                  {r.ok ? <IconCheck size={15} className="text-pine" strokeWidth={2.8} aria-label="OK" /> : <IconX size={15} className="text-berry" strokeWidth={2.8} aria-label="Error" />}
                  {r.line}
                </span>
              </td>
              <td className="px-2.5 py-2">
                <span className="line-clamp-2 break-words">{r.title || <span className="text-muted">–</span>}</span>
                {r.error && <span className="block text-[13px] font-semibold text-berry">{r.error}</span>}
              </td>
              <td className="break-words px-2.5 py-2">{r.recipient || <span className="text-muted">–</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
