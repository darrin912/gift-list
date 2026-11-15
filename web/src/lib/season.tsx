import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Season } from "../api";
import { useSeasons } from "./queries";

const KEY = "gl.seasonId";

interface SeasonCtx {
  seasons: Season[];
  season: Season | undefined;
  seasonId: number | undefined;
  setSeasonId: (id: number) => void;
  isLoading: boolean;
}

const Ctx = createContext<SeasonCtx | null>(null);

function readStored(): number | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v ? Number(v) : undefined;
  } catch {
    return undefined;
  }
}

/** Picks the selected season: the stored choice if it still exists, else the active one, else the newest. */
export function pickSeason(seasons: Season[], stored: number | undefined): Season | undefined {
  return (
    seasons.find((s) => s.id === stored) ??
    seasons.find((s) => s.isActive) ??
    seasons.find((s) => !s.archived) ??
    seasons[0]
  );
}

export function SeasonProvider({ children }: { children: ReactNode }) {
  const q = useSeasons();
  const [stored, setStored] = useState<number | undefined>(readStored);
  const seasons = q.data ?? [];
  const season = pickSeason(seasons, stored);

  useEffect(() => {
    if (stored === undefined) return;
    try {
      localStorage.setItem(KEY, String(stored));
    } catch {
      /* storage unavailable */
    }
  }, [stored]);

  const value = useMemo<SeasonCtx>(
    () => ({ seasons, season, seasonId: season?.id, setSeasonId: setStored, isLoading: q.isLoading }),
    [seasons, season, q.isLoading],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSeason() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSeason outside SeasonProvider");
  return v;
}
