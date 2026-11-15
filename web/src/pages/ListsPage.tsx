import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { SVGProps } from "react";
import { useDraw, useGifts, usePeople } from "../lib/queries";
import { pairHasGift } from "../lib/phase3";
import { useSeason } from "../lib/season";
import { buildGiversMatrix, emptyCellCount, wrapProgress } from "../lib/lists";
import { useMe } from "../lib/queries";
import { PageHeader } from "../components/ui";
import { IconBulb, IconCart, IconChevronLeft, IconChevronRight, IconClock, IconGrid, IconRibbon, IconShuffle } from "../components/Icons";

type IconT = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export default function ListsPage() {
  const { seasonId, season } = useSeason();
  const gifts = useGifts({ seasonId }, seasonId !== undefined);
  const inbox = useGifts({ seasonId: "none" });
  const people = usePeople();
  const me = useMe();
  const draw = useDraw(seasonId);
  const pairs = draw.data?.pairs ?? [];
  const drawDone = pairs.filter((p) => pairHasGift(p, gifts.data ?? [], seasonId)).length;

  const list = gifts.data ?? [];
  const toBuy = list.filter((g) => g.status === "planned").length;
  const wp = wrapProgress(list);
  const matrix = buildGiversMatrix(list, people.data ?? []);
  const missing = matrix.givers.length ? emptyCellCount(matrix, me.data?.personId) : null;
  const ready = !!gifts.data;

  return (
    <>
      <PageHeader title="Lists" sub={season ? `Helpers for ${season.name}` : "Helpers for the season"} />
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Tile to="/lists/shopping" icon={IconCart} tone="var(--st-planned)" title="Shopping list" body="Planned gifts, grouped by store." stat={ready ? (toBuy ? `${toBuy} to buy` : "All bought") : null} />
        <Tile
          to="/lists/wrapping"
          icon={IconRibbon}
          tone="var(--st-wrapped)"
          title="Wrapping & Christmas Eve"
          body="What to wrap, and what goes under the tree."
          stat={ready ? (wp.toWrap ? `${wp.toWrap} to wrap` : wp.here ? `${wp.given} of ${wp.here} given` : "Nothing here yet") : null}
        />
        <Tile
          to="/lists/givers"
          icon={IconGrid}
          tone="var(--st-ordered)"
          title="Givers checklist"
          body="Does every kid have a gift for everyone?"
          stat={ready && missing !== null ? (missing ? `${missing} still empty` : "Everyone covered") : null}
        />
        <Tile
          to="/lists/ideas"
          icon={IconBulb}
          tone="var(--gold)"
          title="Ideas inbox"
          body="Year-round ideas with no season yet."
          stat={inbox.data ? `${inbox.data.length} ${inbox.data.length === 1 ? "idea" : "ideas"}` : null}
        />
        <Tile
          to="/lists/draw"
          icon={IconShuffle}
          tone="var(--st-received)"
          title="Name draw"
          body="Each kid draws a name to give to."
          stat={draw.data ? (pairs.length ? `${drawDone} of ${pairs.length} have a gift` : "Not drawn yet") : null}
        />
        <Tile to="/activity" icon={IconClock} tone="var(--muted)" title="Activity" body="Who added or changed what." />
      </ul>
    </>
  );
}

function Tile({ to, icon: Icon, tone, title, body, stat }: { to: string; icon: IconT; tone: string; title: string; body: string; stat?: string | null }) {
  return (
    <li>
      <Link to={to} className="card flex min-h-[84px] items-center gap-4 p-4 transition-colors hover:border-pine">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl" style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>
          <Icon size={26} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold leading-tight">{title}</span>
          <span className="block text-[14px] text-muted">{body}</span>
          {stat && <span className="tnum mt-1 inline-block text-[14px] font-semibold" style={{ color: tone }}>{stat}</span>}
        </span>
        <IconChevronRight size={20} className="shrink-0 text-muted" />
      </Link>
    </li>
  );
}

/** Back link + header for a page inside the Lists hub. */
export function ListHeader({ title, sub, right, back = "/lists", backLabel = "Lists" }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; back?: string; backLabel?: string }) {
  return (
    <>
      <Link to={back} className="-ml-2 mb-1 inline-flex min-h-[44px] items-center gap-1 pr-3 font-semibold text-muted">
        <IconChevronLeft size={20} /> {backLabel}
      </Link>
      <PageHeader title={title} sub={sub} right={right} />
    </>
  );
}
