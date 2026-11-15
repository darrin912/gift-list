import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Person, type PersonKind } from "../api";
import { formatDate, isGiverOnly, KIND_LABEL } from "../lib/format";
import { birthdaySeasonName, findBirthdaySeason, inDays, nextBirthday, type NextBirthday } from "../lib/phase3";
import { qk, usePeople } from "../lib/queries";
import { useSeason } from "../lib/season";
import { EmptyState, ErrorNote, Loading, PageHeader, PersonBadge } from "../components/ui";
import { IconChevronRight, IconPlus } from "../components/Icons";

const GROUPS: { kind: PersonKind; title: string }[] = [
  { kind: "kid", title: "Kids" },
  { kind: "parent", title: "Parents" },
  { kind: "other", title: "Everyone else" },
];

export default function PeoplePage() {
  const [showArchived, setShowArchived] = useState(false);
  const people = usePeople(showArchived);
  const all = people.data ?? [];
  const list = all.filter((p) => !isGiverOnly(p));
  const tags = all.filter(isGiverOnly);
  const kids = list.filter((p) => p.kind === "kid" && !p.archived);

  return (
    <>
      <PageHeader
        title="People"
        right={
          <Link to="/people/new" className="btn-primary">
            <IconPlus size={20} /> Add
          </Link>
        }
      />
      {people.isLoading && <Loading />}
      <ErrorNote error={people.error} />
      {people.data && (
        <div className="space-y-6">
          {kids.length === 0 && (
            <EmptyState title="Add the kids" body="Each kid gets their own budget, sizes, and gift list." action={<Link to="/people/new?kind=kid" className="btn-primary">Add a kid</Link>} />
          )}
          {GROUPS.map(({ kind, title }) => {
            const group = list.filter((p) => p.kind === kind);
            if (!group.length) return null;
            return (
              <section key={kind}>
                <h2 className="mb-2 text-[15px] font-semibold text-muted">{title}</h2>
                <ul className="card divide-y divide-line overflow-hidden">
                  {group.map((p) => (
                    <PersonRow key={p.id} p={p} />
                  ))}
                </ul>
              </section>
            );
          })}
          {tags.length > 0 && (
            <section aria-labelledby="tags-h">
              <h2 id="tags-h" className="mb-2 text-[15px] font-semibold text-muted">Gift tags (givers only)</h2>
              <ul className="flex flex-wrap gap-2">
                {tags.map((p) => (
                  <li key={p.id}>
                    <Link to={`/people/${p.id}`} className={`chip ${p.archived ? "opacity-60" : ""}`}>
                      <PersonBadge person={p} size={26} />
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[13px] text-muted">Labels you can pick in “From”. They never receive gifts.</p>
            </section>
          )}
          <label className="flex min-h-[48px] items-center gap-3 text-muted">
            <input type="checkbox" className="h-5 w-5 accent-[var(--pine)]" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived people
          </label>
        </div>
      )}
    </>
  );
}

function PersonRow({ p }: { p: Person }) {
  const sizes = Object.entries(p.sizes ?? {}).filter(([, v]) => v);
  const nb = p.archived ? null : nextBirthday(p.birthday);
  const soon = nb && nb.days <= 60 ? nb : null;
  return (
    <li>
      <Link to={`/people/${p.id}`} className={`flex min-h-[64px] items-center gap-3 px-4 py-3 hover:bg-surface-2 ${p.archived ? "opacity-60" : ""}`}>
        <PersonBadge person={p} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">
            {p.name}
            {p.archived && <span className="ml-2 text-[13px] font-medium text-muted">Archived</span>}
          </span>
          {soon ? (
            <span className="block truncate text-[14px] font-semibold text-gold">
              🎂 {inDays(soon.days)}
              <span className="font-normal text-muted">
                {" · "}
                {formatDate(soon.date)}
                {soon.turning ? ` · turns ${soon.turning}` : ""}
              </span>
            </span>
          ) : (
            <span className="block truncate text-[14px] text-muted">
              {sizes.length ? sizes.map(([k, v]) => `${k} ${v}`).join(", ") : KIND_LABEL[p.kind]}
            </span>
          )}
        </span>
        <IconChevronRight size={20} className="text-muted" />
      </Link>
      {soon && <PlanBirthday p={p} nb={soon} />}
    </li>
  );
}

/** Creates (or opens) this person's birthday season, then shows it on the dashboard. */
function PlanBirthday({ p, nb }: { p: Person; nb: NextBirthday }) {
  const { seasons, setSeasonId } = useSeason();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const existing = findBirthdaySeason(seasons, p.id, nb.date);
  const open = (id: number) => {
    setSeasonId(id);
    navigate("/");
  };
  const create = useMutation({
    mutationFn: () =>
      api.seasons.create({ kind: "birthday", honoreeId: p.id, name: birthdaySeasonName(p.name, nb.date), date: nb.date, overallBudgetCents: 0, isActive: false, archived: false }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: qk.seasons });
      if (s?.id) open(s.id);
    },
  });
  return (
    <div className="-mt-1 flex items-center gap-2 pb-3 pl-[68px] pr-4">
      <button
        type="button"
        className="chip !min-h-[36px] border-gold text-[14px] font-semibold text-gold"
        style={{ background: "var(--gold-soft)" }}
        disabled={create.isPending}
        onClick={() => (existing ? open(existing.id) : create.mutate())}
      >
        {existing ? "Open birthday" : create.isPending ? "Creating…" : "Plan birthday"}
      </button>
      {create.isError && <span className="text-[13px] font-semibold text-berry">Couldn't create it. Try again.</span>}
    </div>
  );
}
