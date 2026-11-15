import { useState } from "react";
import { dayLabel, groupByDay } from "../lib/activity";
import { useActivity, usePeopleMap } from "../lib/queries";
import { useSeason } from "../lib/season";
import { ActivityRow } from "../components/Activity";
import { EmptyState, ErrorNote, Loading } from "../components/ui";
import { ListHeader } from "./ListsPage";

export default function ActivityPage() {
  const { seasonId, season } = useSeason();
  const [onlySeason, setOnlySeason] = useState(false);
  const activity = useActivity(100, onlySeason ? seasonId : undefined);
  const map = usePeopleMap();
  const days = groupByDay(activity.data ?? []);

  return (
    <>
      <ListHeader title="Activity" sub="Who added or changed what. Surprises for you are left out." />
      {season && (
        <div className="mb-4 flex gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Which activity">
          {[
            [false, "Everything"],
            [true, season.name],
          ].map(([v, label]) => (
            <button
              key={String(v)}
              role="tab"
              aria-selected={onlySeason === v}
              onClick={() => setOnlySeason(v as boolean)}
              className={`min-h-[40px] min-w-0 flex-1 truncate rounded-lg px-2 text-[15px] font-semibold transition-colors ${onlySeason === v ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
            >
              {label as string}
            </button>
          ))}
        </div>
      )}
      {activity.isLoading ? (
        <Loading />
      ) : activity.error ? (
        <ErrorNote error={activity.error} />
      ) : days.length === 0 ? (
        <EmptyState title="Nothing yet" body="Changes to gifts show up here as you both add and update them." />
      ) : (
        <div className="space-y-5">
          {days.map((d) => (
            <section key={d.day} aria-label={dayLabel(d.day)}>
              <h2 className="mb-2 text-[15px] font-semibold text-muted">{dayLabel(d.day)}</h2>
              <ul className="card divide-y divide-line overflow-hidden py-1">
                {d.entries.map((e) => (
                  <ActivityRow key={e.id} e={e} map={map} />
                ))}
              </ul>
            </section>
          ))}
          {(activity.data?.length ?? 0) >= 100 && <p className="text-[14px] text-muted">Showing the latest 100 changes.</p>}
        </div>
      )}
    </>
  );
}
