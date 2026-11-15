import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Gift, type GiftFilters, type GiftInput, type Person } from "../api";

export const qk = {
  me: ["me"] as const,
  people: (all = false) => ["people", all] as const,
  seasons: ["seasons"] as const,
  budgets: (seasonId: number) => ["budgets", seasonId] as const,
  gifts: (f: GiftFilters) => ["gifts", f] as const,
  gift: (id: number) => ["gift", id] as const,
  stores: ["stores"] as const,
  dashboard: (seasonId: number | undefined) => ["dashboard", seasonId ?? "active"] as const,
};

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: api.auth.me, staleTime: 5 * 60_000 });
export const usePeople = (includeArchived = false) =>
  useQuery({ queryKey: qk.people(includeArchived), queryFn: () => api.people.list(includeArchived) });
export const useSeasons = () => useQuery({ queryKey: qk.seasons, queryFn: api.seasons.list });
export const useBudgets = (seasonId: number | undefined) =>
  useQuery({ queryKey: qk.budgets(seasonId ?? -1), queryFn: () => api.seasons.budgets(seasonId!), enabled: seasonId !== undefined });
export const useGifts = (f: GiftFilters, enabled = true) =>
  useQuery({ queryKey: qk.gifts(f), queryFn: () => api.gifts.list(f), enabled });
export const useStores = () => useQuery({ queryKey: qk.stores, queryFn: api.stores, staleTime: 60_000 });
export const useDashboard = (seasonId: number | undefined, enabled = true) =>
  useQuery({ queryKey: qk.dashboard(seasonId), queryFn: () => api.dashboard(seasonId), enabled });

/** Map of person id → person (includes archived so old gifts still show a name). */
export function usePeopleMap() {
  const q = usePeople(true);
  const map = new Map<number, Person>();
  for (const p of q.data ?? []) map.set(p.id, p);
  return map;
}

/** Invalidate everything a gift change can affect. */
export function useInvalidateGifts() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["gifts"] });
    qc.invalidateQueries({ queryKey: ["gift"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: qk.stores });
  };
}

/** PATCH a gift with an optimistic update of every cached gift list. */
export function useUpdateGift() {
  const qc = useQueryClient();
  const invalidate = useInvalidateGifts();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: GiftInput }) => api.gifts.update(id, input),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: ["gifts"] });
      const prev = qc.getQueriesData<Gift[]>({ queryKey: ["gifts"] });
      qc.setQueriesData<Gift[]>({ queryKey: ["gifts"] }, (old) =>
        old?.map((g) => (g.id === id ? ({ ...g, ...input } as Gift) : g)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData<Gift[]>(key, data));
    },
    onSettled: invalidate,
  });
}
