import { Link } from "react-router-dom";
import type { ActivityEntry } from "../api";
import { timeAgo } from "../lib/activity";
import { activityActor } from "../lib/phase3";

const ACTION_COLOR: Record<ActivityEntry["action"], string> = {
  created: "var(--pine)",
  updated: "var(--st-ordered)",
  deleted: "var(--berry)",
};

/** One row of the activity feed: who, what, when. Links to the gift when it still exists. */
export function ActivityRow({ e, compact = false }: { e: ActivityEntry; compact?: boolean }) {
  const actor = activityActor(e);
  const system = e.userId === null || !e.userName;
  const dot = system ? "var(--gold)" : (ACTION_COLOR[e.action] ?? "var(--muted)");
  const body = (
    <>
      <span
        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: dot, boxShadow: `0 0 0 3px color-mix(in srgb, ${dot} 18%, transparent)` }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className={`block ${compact ? "line-clamp-2" : ""} text-[15px] leading-snug`}>{e.summary}</span>
        <span className="block text-[13px] text-muted">
          {system ? <span className="font-semibold text-gold">⬇ {actor}</span> : actor}
          {" · "}
          <time dateTime={e.at}>{timeAgo(e.at)}</time>
        </span>
      </span>
    </>
  );
  const cls = `flex items-start gap-3 px-5 py-2.5 ${compact ? "" : "min-h-[56px]"}`;
  return (
    <li>
      {e.giftId !== null && e.action !== "deleted" ? (
        <Link to={`/gifts/${e.giftId}`} className={`${cls} hover:bg-surface-2`}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}
