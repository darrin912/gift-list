import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Person, type Season, type SeasonInput, type SeasonKind } from "../api";
import { centsToInput, formatCents, formatDate, parseDollars, SEASON_KIND_LABEL } from "../lib/format";
import { qk, useBudgets, useMe, usePeople } from "../lib/queries";
import { useSeason } from "../lib/season";
import { ErrorNote, Loading, PageHeader, PersonBadge, Toggle } from "../components/ui";
import { IconLogout, IconPlus } from "../components/Icons";
import { Money } from "./GiftFormPage";

export default function SettingsPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 md:grid-cols-2 md:items-start">
        <div className="space-y-6">
          <Seasons />
          <Budgets />
        </div>
        <div className="space-y-6">
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
                    {[SEASON_KIND_LABEL[s.kind], s.date ? formatDate(s.date) : null, `${formatCents(s.overallBudgetCents, { round: true })} budget`].filter(Boolean).join(" · ")}
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
  const year = new Date().getFullYear();
  const [f, setF] = useState({
    name: season?.name ?? `Christmas ${year}`,
    kind: season?.kind ?? ("christmas" as SeasonKind),
    date: season?.date ?? `${year}-12-25`,
    budget: centsToInput(season?.overallBudgetCents ?? null),
    isActive: season?.isActive ?? seasons.length === 0,
    archived: season?.archived ?? false,
  });
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

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
    if (!f.name.trim()) return setErr("Add a name.");
    if (!f.date) return setErr("Add the date of the occasion.");
    if (Number.isNaN(cents)) return setErr("Enter the budget in dollars, like 1500.");
    setErr(null);
    save.mutate({ name: f.name.trim(), kind: f.kind, date: f.date, overallBudgetCents: cents, isActive: f.isActive, archived: f.archived });
  }

  return (
    <form onSubmit={submit} className="mb-3 space-y-3 rounded-xl bg-surface-2 p-4" noValidate>
      <div>
        <label htmlFor={`sn${season?.id ?? "new"}`} className="label">Name</label>
        <input id={`sn${season?.id ?? "new"}`} className="field" value={f.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`sk${season?.id ?? "new"}`} className="label">Occasion</label>
          <select id={`sk${season?.id ?? "new"}`} className="field" value={f.kind} onChange={(e) => set("kind", e.target.value as SeasonKind)}>
            {(Object.keys(SEASON_KIND_LABEL) as SeasonKind[]).map((k) => (
              <option key={k} value={k}>{SEASON_KIND_LABEL[k]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`sd${season?.id ?? "new"}`} className="label">Date</label>
          <input id={`sd${season?.id ?? "new"}`} type="date" className="field" value={f.date} onChange={(e) => set("date", e.target.value)} />
        </div>
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
  if (!season) return null;
  const list = (people.data ?? []).filter((p) => !p.archived && p.name !== "Santa");
  return (
    <Section id="budgets" title="Budgets" sub={`Per person for ${season.name}. Saves when you leave a field.`}>
      <ErrorNote error={budgets.error} />
      {budgets.isLoading ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-[1fr_6.5rem_6.5rem] items-center gap-x-2 gap-y-2">
          <span />
          <span className="text-[13px] font-semibold text-muted">Gifts</span>
          <span className="text-[13px] font-semibold text-muted">🧦 Stocking</span>
          {list.map((p) => {
            const row = budgets.data?.find((b) => b.personId === p.id);
            // Keyed by season + person only: keying on the saved values remounted the row after
            // every save, wiping whatever was being typed in the other field of that row.
            return <BudgetRow key={`${season.id}-${p.id}`} seasonId={season.id} person={p} budget={row?.budgetCents ?? 0} stocking={row?.stockingBudgetCents ?? 0} />;
          })}
        </div>
      )}
    </Section>
  );
}

function BudgetRow({ seasonId, person, budget, stocking }: { seasonId: number; person: Person; budget: number; stocking: number }) {
  const qc = useQueryClient();
  const [b, setB] = useState(centsToInput(budget || null));
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
