import { NavLink, Outlet } from "react-router-dom";
import { useSeason } from "../lib/season";
import { IconGift, IconHome, IconPeople, IconSettings } from "./Icons";

const tabs = [
  { to: "/", label: "Dashboard", icon: IconHome, end: true },
  { to: "/gifts", label: "Gifts", icon: IconGift, end: false },
  { to: "/people", label: "People", icon: IconPeople, end: false },
  { to: "/settings", label: "Settings", icon: IconSettings, end: false },
];

function SeasonSwitcher() {
  const { seasons, seasonId, setSeasonId } = useSeason();
  if (!seasons.length) return null;
  return (
    <label className="relative inline-flex min-w-0 items-center">
      <span className="sr-only">Season</span>
      <select
        value={seasonId ?? ""}
        onChange={(e) => setSeasonId(Number(e.target.value))}
        className="h-10 min-w-0 max-w-[13rem] cursor-pointer appearance-none truncate rounded-full border bg-[color-mix(in_srgb,var(--band-ink)_14%,transparent)] pl-4 pr-9 text-[15px] font-semibold text-band-ink outline-none focus-visible:ring-2 focus-visible:ring-band-ink"
      >
        {seasons.map((s) => (
          <option key={s.id} value={s.id} className="bg-surface text-ink">
            {s.name}
            {s.archived ? " (archived)" : ""}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-3 text-band-ink" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}

function Wordmark() {
  return (
    <NavLink to="/" className="flex items-center gap-2 text-band-ink" aria-label="Gift List home">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M6 9h20l-2 6H8z" fill="none" />
        <path d="M5 12h22v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" fill="currentColor" opacity=".22" />
        <rect x="4" y="9" width="24" height="5" rx="1.5" fill="currentColor" />
        <rect x="14.5" y="9" width="3" height="19" fill="var(--berry)" />
        <path d="M16 9c-1.5-4-6.5-5.5-6.5-2.5 0 2 4 2.5 6.5 2.5Zm0 0c1.5-4 6.5-5.5 6.5-2.5 0 2-4 2.5-6.5 2.5Z" fill="none" stroke="var(--berry)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span className="text-[20px] font-extrabold tracking-[-0.02em] [font-stretch:90%]">Gift List</span>
    </NavLink>
  );
}

export default function Layout() {
  return (
    <div className="min-h-dvh">
      <header className="snowfall pt-safe sticky top-0 z-30 bg-band text-band-ink">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 md:h-16">
          <Wordmark />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `rounded-full px-4 py-2 text-[15px] font-semibold transition-colors ${
                    isActive ? "bg-band-ink text-band" : "text-band-ink hover:bg-[color-mix(in_srgb,var(--band-ink)_12%,transparent)]"
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          <SeasonSwitcher />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-32 pt-5 md:pb-16 md:pt-8">
        <Outlet />
      </main>

      <nav
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface md:hidden"
        aria-label="Main"
      >
        <div className="grid grid-cols-4">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[12px] font-semibold ${isActive ? "text-pine" : "text-muted"}`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${isActive ? "bg-pine-soft" : ""}`}>
                    <t.icon size={22} strokeWidth={isActive ? 2.4 : 2} />
                  </span>
                  {t.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
