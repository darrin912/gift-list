import { Link } from "react-router-dom";
import type { Gift, Person } from "../api";
import { buildGiversMatrix, cellKey, emptyCellCount, type GiversMatrix } from "../lib/lists";
import { useGifts, useMe, usePeople } from "../lib/queries";
import { isShared } from "../lib/recipients";
import { useSeason } from "../lib/season";
import { EmptyState, ErrorNote, Loading, PersonBadge } from "../components/ui";
import { IconPlus } from "../components/Icons";
import { ListHeader } from "./ListsPage";

const addHref = (giver: Person, recipient: Person) => `/gifts/new?recipientIds=${recipient.id}&from=${giver.id}`;

export default function GiversPage() {
  const { seasonId, season } = useSeason();
  const gifts = useGifts({ seasonId }, seasonId !== undefined);
  const people = usePeople();
  const me = useMe();
  const viewer = me.data?.personId ?? null;

  if (seasonId === undefined)
    return (
      <>
        <ListHeader title="Givers checklist" />
        <EmptyState title="No season yet" body="Create a season in Settings first." action={<Link to="/settings#seasons" className="btn-primary">Create a season</Link>} />
      </>
    );

  const m = buildGiversMatrix(gifts.data ?? [], people.data ?? []);
  const missing = emptyCellCount(m, viewer);

  return (
    <>
      <ListHeader
        title="Givers checklist"
        sub={season ? `${season.name} · gifts from each kid` : undefined}
      />
      {gifts.isLoading || people.isLoading ? (
        <Loading />
      ) : gifts.error ? (
        <ErrorNote error={gifts.error} />
      ) : m.givers.length === 0 ? (
        <EmptyState title="No kids yet" body="Add kids on the People screen to check who each one is giving to." action={<Link to="/people/new?kind=kid" className="btn-primary">Add a kid</Link>} />
      ) : (
        <>
          <p className={`mb-4 inline-flex rounded-full px-3 py-1 text-[14px] font-semibold ${missing ? "bg-gold-soft text-gold" : "bg-pine-soft text-pine"}`}>
            {missing ? `${missing} ${missing === 1 ? "gift" : "gifts"} still to find` : "Every kid has a gift for everyone"}
          </p>
          <div className="space-y-4 md:hidden">
            {m.givers.map((g) => (
              <GiverCard key={g.id} giver={g} m={m} viewer={viewer} />
            ))}
          </div>
          <MatrixTable m={m} viewer={viewer} />
          {viewer !== null && m.recipients.some((r) => r.id === viewer) && (
            <p className="mt-4 text-[14px] text-muted">🤫 Gifts for you are hidden, so your column always looks empty here.</p>
          )}
        </>
      )}
    </>
  );
}

function GiverCard({ giver, m, viewer }: { giver: Person; m: GiversMatrix; viewer: number | null }) {
  const targets = m.recipients.filter((r) => r.id !== giver.id);
  const covered = targets.filter((r) => r.id !== viewer && m.cells.get(cellKey(giver.id, r.id))?.length).length;
  const countable = targets.filter((r) => r.id !== viewer).length;
  return (
    <section className="card overflow-hidden" aria-label={`From ${giver.name}`}>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3" style={{ background: `color-mix(in srgb, ${giver.color || "var(--line)"} 10%, var(--surface))` }}>
        <PersonBadge person={giver} size={36} />
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-bold">From {giver.name}</h2>
        <span className="tnum text-[14px] font-semibold text-muted">
          {covered}/{countable}
        </span>
      </header>
      <ul className="divide-y divide-line">
        {targets.map((r) => {
          const list = m.cells.get(cellKey(giver.id, r.id)) ?? [];
          const hidden = r.id === viewer;
          return (
            <li key={r.id} className={`flex items-center gap-3 py-2 pl-4 pr-2 ${!list.length && !hidden ? "[background:color-mix(in_srgb,var(--gold-soft)_65%,transparent)]" : ""}`}>
              <PersonBadge person={r} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{r.name}</div>
                {list.length > 0 ? (
                  <Titles gifts={list} />
                ) : hidden ? (
                  <div className="text-[14px] text-muted">🤫 hidden from you</div>
                ) : (
                  <div className="text-[14px] font-medium text-gold">Nothing yet</div>
                )}
              </div>
              {!list.length && !hidden && (
                <Link to={addHref(giver, r)} className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full bg-surface px-3.5 text-[15px] font-semibold text-pine ring-1 ring-line" aria-label={`Add a gift from ${giver.name} for ${r.name}`}>
                  <IconPlus size={18} /> add
                </Link>
              )}
              {list.length > 0 && <span className="tnum mr-2 shrink-0 rounded-full bg-pine-soft px-2.5 py-0.5 text-[14px] font-bold text-pine">{list.length}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Titles({ gifts }: { gifts: Gift[] }) {
  return (
    <div className="truncate text-[14px] text-muted">
      {gifts.map((g, i) => (
        <span key={g.id}>
          {i > 0 && ", "}
          <Link to={`/gifts/${g.id}`} className="hover:text-ink hover:underline">
            {g.title}
          </Link>
          {isShared(g) && <span className="text-[12px]"> (shared)</span>}
        </span>
      ))}
    </div>
  );
}

function MatrixTable({ m, viewer }: { m: GiversMatrix; viewer: number | null }) {
  return (
    <div className="card hidden overflow-x-auto md:block">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Gifts from each kid (rows) to each family member (columns)</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="sticky left-0 bg-surface px-4 py-3 text-[13px] font-semibold text-muted">
              From ↓ / For →
            </th>
            {m.recipients.map((r) => (
              <th key={r.id} scope="col" className="px-3 py-3 text-[15px] font-bold">
                <span className="inline-flex items-center gap-2">
                  <PersonBadge person={r} size={26} />
                  {r.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.givers.map((g) => (
            <tr key={g.id} className="border-b border-line last:border-0">
              <th scope="row" className="sticky left-0 bg-surface px-4 py-3 font-bold">
                <span className="inline-flex items-center gap-2">
                  <PersonBadge person={g} size={28} />
                  {g.name}
                </span>
              </th>
              {m.recipients.map((r) => {
                if (r.id === g.id) return <td key={r.id} className="bg-surface-2 px-3 py-3 text-center text-muted" aria-label="Self">—</td>;
                const list = m.cells.get(cellKey(g.id, r.id)) ?? [];
                if (r.id === viewer && !list.length) return <td key={r.id} className="px-3 py-3 text-[14px] text-muted">🤫</td>;
                if (!list.length)
                  return (
                    <td key={r.id} className="bg-gold-soft px-2 py-2">
                      <Link to={addHref(g, r)} className="inline-flex min-h-[40px] items-center gap-1 rounded-full px-3 text-[14px] font-semibold text-gold hover:bg-surface" aria-label={`Add a gift from ${g.name} for ${r.name}`}>
                        <IconPlus size={16} /> add
                      </Link>
                    </td>
                  );
                return (
                  <td key={r.id} className="max-w-[12rem] px-3 py-3 align-top">
                    <span className="tnum mr-1.5 rounded-full bg-pine-soft px-2 py-0.5 text-[13px] font-bold text-pine">{list.length}</span>
                    <Titles gifts={list} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
