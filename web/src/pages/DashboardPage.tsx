import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Dashboard, DashboardPerson, GiftStatus, Person } from "../api";
import { formatCents, formatDate, ratio, returnPhrase, ALL_STATUSES, STATUS_LABEL } from "../lib/format";
import { usePeople, usePeopleMap, useDashboard } from "../lib/queries";
import { useSeason } from "../lib/season";
import { EmptyState, ErrorNote, Loading, MoneyBar, PageHeader, PersonBadge, statusVar } from "../components/ui";
import { IconChevronRight } from "../components/Icons";

export default function DashboardPage() {
  const { seasons, seasonId, season, isLoading: seasonsLoading } = useSeason();
  const people = usePeople();
  const dash = useDashboard(seasonId, seasonId !== undefined);
  const map = usePeopleMap();

  if (seasonsLoading || people.isLoading) return <Loading />;

  const kids = (people.data ?? []).filter((p) => p.kind === "kid");

  if (!seasons.length) {
    return (
      <>
        <PageHeader title="Welcome" sub="Let's set up this year's gifts." />
        <div className="space-y-4">
          <EmptyState
            title="Start a season"
            body="A season holds one occasion's gifts and budget, like Christmas 2026. Create one to see totals here."
            action={<Link to="/settings#seasons" className="btn-primary">Create a season</Link>}
          />
          {kids.length === 0 && <AddPeoplePrompt />}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={season?.name ?? "Dashboard"} sub={season?.date ? countdown(season.date) : undefined} />
      {dash.isLoading && <Loading />}
      <ErrorNote error={dash.error} />
      {dash.data && (
        <div className="grid gap-5 md:grid-cols-[1.15fr_1fr] md:items-start">
          <div className="space-y-5">
            <PotCard d={dash.data} />
            <Attention d={dash.data} map={map} />
          </div>
          <div className="space-y-5">
            {kids.length === 0 ? <AddPeoplePrompt /> : <Fairness d={dash.data} map={map} />}
            <PeopleCards d={dash.data} map={map} />
          </div>
        </div>
      )}
    </>
  );
}

function countdown(date: string) {
  const today = new Date();
  const [y, m, d] = date.split("-").map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000);
  if (days > 1) return `${days} days to go · ${formatDate(date)}`;
  if (days === 1) return "Tomorrow!";
  if (days === 0) return "Today!";
  return formatDate(date);
}

function AddPeoplePrompt() {
  return (
    <EmptyState
      title="Add the kids"
      body="Add each kid on the People screen to track their gifts, budgets, and sizes."
      action={<Link to="/people/new" className="btn-primary">Add a person</Link>}
    />
  );
}

function PotCard({ d }: { d: Dashboard }) {
  const t = d.totals;
  const over = t.remainingCents < 0;
  return (
    <section className="card overflow-hidden" aria-labelledby="pot-h">
      <div className="p-5">
        <h2 id="pot-h" className="text-[15px] font-semibold text-muted">Shared pot</h2>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className={`tnum text-[44px] font-extrabold leading-none tracking-[-0.03em] [font-stretch:88%] ${over ? "text-berry" : ""}`}>
            {formatCents(Math.abs(t.remainingCents), { round: true })}
          </span>
          <span className="text-[17px] text-muted">
            {over ? "over" : "left"} of {formatCents(t.budgetCents, { round: true })}
          </span>
        </p>
        <MoneyBar spent={t.spentCents} committed={t.committedCents} budget={t.budgetCents} className="mt-4 !h-4" />
      </div>
      <dl className="grid grid-cols-3 border-t border-line text-center">
        <Stat label="Spent" value={formatCents(t.spentCents, { round: true })} swatch="var(--pine)" />
        <Stat label="Committed" value={formatCents(t.committedCents, { round: true })} swatch="hatch" />
        <Stat label="Gifts" value={String(t.giftCount)} />
      </dl>
      <p className="border-t border-line bg-surface-2 px-5 py-2.5 text-[13px] text-muted">Excludes gifts hidden from you.</p>
    </section>
  );
}

function Stat({ label, value, swatch }: { label: string; value: string; swatch?: string }) {
  return (
    <div className="border-line px-2 py-3 [&:not(:first-child)]:border-l">
      <dt className="flex items-center justify-center gap-1.5 text-[13px] text-muted">
        {swatch && (
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{
              background: swatch === "hatch" ? "repeating-linear-gradient(-45deg, var(--pine) 0 2px, transparent 2px 4px)" : swatch,
              boxShadow: swatch === "hatch" ? "inset 0 0 0 1px var(--pine)" : undefined,
            }}
          />
        )}
        {label}
      </dt>
      <dd className="tnum text-[19px] font-bold">{value}</dd>
    </div>
  );
}

function Fairness({ d, map }: { d: Dashboard; map: Map<number, Person> }) {
  const rows = d.fairness.filter((f) => map.has(f.personId));
  if (!rows.length) return null;
  const maxMoney = Math.max(...rows.map((r) => r.spentCents + r.committedCents), 1);
  const maxCount = Math.max(...rows.map((r) => r.giftCount), 1);
  return (
    <section className="card p-5" aria-labelledby="fair-h">
      <h2 id="fair-h" className="text-[19px] font-bold">Fairness</h2>
      <p className="text-[14px] text-muted">Spent and planned, kid by kid.</p>
      <ul className="mt-4 space-y-4">
        {rows.map((r) => {
          const p = map.get(r.personId);
          const color = p?.color || "var(--pine)";
          const money = r.spentCents + r.committedCents;
          return (
            <li key={r.personId} className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
              <PersonBadge person={p} size={32} />
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold">{p?.name}</span>
                <span className="tnum shrink-0 text-[15px]">
                  <b>{formatCents(money, { round: true })}</b>
                  <span className="text-muted"> · {r.giftCount} {r.giftCount === 1 ? "gift" : "gifts"}</span>
                </span>
              </div>
              <div className="col-start-2 space-y-1">
                <div className="h-2.5 rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${ratio(money, maxMoney) * 100}%`, background: color }} />
                </div>
                <div className="flex gap-[3px]" aria-hidden="true">
                  {Array.from({ length: Math.min(r.giftCount, 30) }).map((_, i) => (
                    <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ background: color, opacity: 0.55 }} />
                  ))}
                  {r.giftCount === 0 && <span className="text-[12px] text-muted">No gifts yet</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="sr-only">Largest total is {formatCents(maxMoney)} and {maxCount} gifts.</p>
    </section>
  );
}

function PeopleCards({ d, map }: { d: Dashboard; map: Map<number, Person> }) {
  const rows = d.people
    .filter((r) => map.has(r.personId))
    .sort((a, b) => (map.get(a.personId)!.sortOrder ?? 0) - (map.get(b.personId)!.sortOrder ?? 0));
  if (!rows.length) return null;
  return (
    <section aria-labelledby="people-h">
      <h2 id="people-h" className="mb-3 text-[19px] font-bold">People</h2>
      <ul className="grid gap-3">
        {rows.map((r) => (
          <li key={r.personId}>
            <PersonCard r={r} person={map.get(r.personId)!} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PersonCard({ r, person }: { r: DashboardPerson; person: Person }) {
  const used = r.spentCents + r.committedCents;
  return (
    <Link to={`/people/${person.id}`} className="card block p-4 transition-colors hover:border-pine">
      <div className="flex items-center gap-3">
        <PersonBadge person={person} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{person.name}</div>
          {r.hidden ? (
            <div className="text-[15px] text-muted">🤫 Surprises hidden</div>
          ) : (
            <div className="tnum text-[15px] text-muted">
              <b className="text-ink">{formatCents(used, { round: true })}</b>
              {r.budgetCents > 0 ? ` of ${formatCents(r.budgetCents, { round: true })}` : " · no budget set"}
            </div>
          )}
        </div>
        <IconChevronRight className="text-muted" size={20} />
      </div>
      {!r.hidden && (
        <>
          {r.budgetCents > 0 && <MoneyBar spent={r.spentCents} committed={r.committedCents} budget={r.budgetCents} className="mt-3" />}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            {ALL_STATUSES.filter((s) => (r.countsByStatus[s] ?? 0) > 0).map((s: GiftStatus) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: statusVar(s) }} />
                <span className="tnum font-semibold">{r.countsByStatus[s]}</span>
                <span className="text-muted">{STATUS_LABEL[s].toLowerCase()}</span>
              </span>
            ))}
            {r.giftCount === 0 && <span className="text-muted">No gifts yet</span>}
            {r.stockingCount > 0 && (
              <span className="ml-auto text-muted">
                🧦 <span className="tnum font-semibold text-ink">{r.stockingCount}</span> stocking
              </span>
            )}
          </div>
        </>
      )}
    </Link>
  );
}

function Attention({ d, map }: { d: Dashboard; map: Map<number, Person> }) {
  const a = d.attention;
  const total = a.returnsSoon.length + a.orderedNotReceived.length + a.receivedNotWrapped.length;
  const name = (id: number) => map.get(id)?.name ?? "Someone";
  return (
    <section className="card" aria-labelledby="att-h">
      <div className="flex items-baseline justify-between px-5 pb-2 pt-5">
        <h2 id="att-h" className="text-[19px] font-bold">Needs attention</h2>
        {total > 0 && <span className="tnum text-[14px] text-muted">{total}</span>}
      </div>
      {total === 0 ? (
        <p className="px-5 pb-5 text-muted">Nothing waiting on you. Nice.</p>
      ) : (
        <div className="pb-2">
          {a.returnsSoon.length > 0 && (
            <Group title="Return windows">
              {[...a.returnsSoon]
                .sort((x, y) => x.returnBy.localeCompare(y.returnBy))
                .map((g) => (
                  <Row
                    key={`r${g.giftId}`}
                    to={`/gifts/${g.giftId}`}
                    title={g.title}
                    meta={`${name(g.recipientId)} · ${returnPhrase(g.returnBy)}`}
                    tone={g.level}
                  />
                ))}
            </Group>
          )}
          {a.orderedNotReceived.length > 0 && (
            <Group title="Ordered, not here yet">
              {a.orderedNotReceived.map((g) => (
                <Row key={`o${g.giftId}`} to={`/gifts/${g.giftId}`} title={g.title} meta={[name(g.recipientId), g.store].filter(Boolean).join(" · ")} dot="var(--st-ordered)" />
              ))}
            </Group>
          )}
          {a.receivedNotWrapped.length > 0 && (
            <Group title="Here, not wrapped">
              {a.receivedNotWrapped.map((g) => (
                <Row key={`w${g.giftId}`} to={`/gifts/${g.giftId}`} title={g.title} meta={name(g.recipientId)} dot="var(--st-received)" />
              ))}
            </Group>
          )}
        </div>
      )}
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-1">
      <h3 className="px-5 pb-1 pt-2 text-[13px] font-semibold text-muted">{title}</h3>
      <ul>{children}</ul>
    </div>
  );
}

function Row({ to, title, meta, tone, dot }: { to: string; title: string; meta: string; tone?: "amber" | "red"; dot?: string }) {
  const toneColor = tone === "red" ? "var(--berry)" : tone === "amber" ? "var(--gold)" : undefined;
  return (
    <li>
      <Link to={to} className="flex min-h-[56px] items-center gap-3 px-5 py-2 hover:bg-surface-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: toneColor ?? dot, boxShadow: tone ? `0 0 0 4px ${tone === "red" ? "var(--berry-soft)" : "var(--gold-soft)"}` : undefined }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{title}</span>
          <span className="block truncate text-[14px]" style={{ color: toneColor ?? "var(--muted)" }}>
            {meta}
          </span>
        </span>
        <IconChevronRight size={18} className="shrink-0 text-muted" />
      </Link>
    </li>
  );
}
