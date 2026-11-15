import { useState } from "react";
import { Link } from "react-router-dom";
import type { Person, PersonKind } from "../api";
import { KIND_LABEL } from "../lib/format";
import { usePeople } from "../lib/queries";
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
  const list = people.data ?? [];
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
  return (
    <li>
      <Link to={`/people/${p.id}`} className={`flex min-h-[64px] items-center gap-3 px-4 py-3 hover:bg-surface-2 ${p.archived ? "opacity-60" : ""}`}>
        <PersonBadge person={p} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">
            {p.name}
            {p.archived && <span className="ml-2 text-[13px] font-medium text-muted">Archived</span>}
          </span>
          <span className="block truncate text-[14px] text-muted">
            {sizes.length ? sizes.map(([k, v]) => `${k} ${v}`).join(", ") : KIND_LABEL[p.kind]}
          </span>
        </span>
        <IconChevronRight size={20} className="text-muted" />
      </Link>
    </li>
  );
}
