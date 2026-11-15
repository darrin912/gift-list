import { asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { gifts, people, personBudgets, seasons, type GiftStatus, type SeasonRow } from "../../db/schema";
import { loadVisibleGifts } from "../gift-access";
import { notFound, parseQuery } from "../http";
import {
  emptyStatusCounts,
  isCounted,
  isSeasonSecret,
  remainingCents,
  returnByLevel,
  sumMoney,
} from "../rules";
import { toSeason, type ApiSeason } from "../serialize";
import type { AppEnv, Variables } from "../types";
import { dashboardQuery } from "../validation";

type Db = Variables["db"];

export interface DashboardPerson {
  personId: number;
  hidden: boolean;
  budgetCents: number;
  stockingBudgetCents: number;
  spentCents: number;
  committedCents: number;
  giftCount: number;
  stockingCount: number;
  countsByStatus: Record<GiftStatus, number>;
}

export interface Dashboard {
  season: ApiSeason | null;
  totals: { budgetCents: number; spentCents: number; committedCents: number; remainingCents: number; giftCount: number };
  people: DashboardPerson[];
  fairness: { personId: number; spentCents: number; committedCents: number; giftCount: number }[];
  attention: {
    returnsSoon: { giftId: number; title: string; recipientId: number; returnBy: string; level: "amber" | "red" }[];
    orderedNotReceived: { giftId: number; title: string; recipientId: number; store: string }[];
    receivedNotWrapped: { giftId: number; title: string; recipientId: number }[];
  };
}

function emptyDashboard(season: ApiSeason | null): Dashboard {
  return {
    season,
    totals: {
      budgetCents: season?.overallBudgetCents ?? 0,
      spentCents: 0,
      committedCents: 0,
      remainingCents: season?.overallBudgetCents ?? 0,
      giftCount: 0,
    },
    people: [],
    fairness: [],
    attention: { returnsSoon: [], orderedNotReceived: [], receivedNotWrapped: [] },
  };
}

export async function buildDashboard(
  db: Db,
  viewer: Variables["user"],
  today: string,
  season: SeasonRow,
): Promise<Dashboard> {
  const [visible, allPeople, budgets] = await Promise.all([
    loadVisibleGifts(db, viewer, today, eq(gifts.seasonId, season.id)),
    db.select().from(people).orderBy(asc(people.sortOrder), sql`${people.name} COLLATE NOCASE`, asc(people.id)).all(),
    db.select().from(personBudgets).where(eq(personBudgets.seasonId, season.id)).all(),
  ]);
  const seasonGifts = visible.map((r) => r.gift);
  const budgetBy = new Map(budgets.map((b) => [b.personId, b]));
  const giftsBy = new Map<number, typeof seasonGifts>();
  for (const g of seasonGifts) {
    const list = giftsBy.get(g.recipientId) ?? [];
    list.push(g);
    giftsBy.set(g.recipientId, list);
  }
  const secret = isSeasonSecret(season, today);

  // Show non-archived parents and kids, plus anyone with a budget or (visible) gifts this season.
  const shown = allPeople.filter(
    (p) =>
      (!p.archived && p.kind !== "other") ||
      budgetBy.has(p.id) ||
      giftsBy.has(p.id) ||
      (secret && p.id === viewer.personId && !p.archived),
  );

  const dashPeople: DashboardPerson[] = shown.map((p) => {
    if (secret && p.id === viewer.personId) {
      return {
        personId: p.id,
        hidden: true,
        budgetCents: 0,
        stockingBudgetCents: 0,
        spentCents: 0,
        committedCents: 0,
        giftCount: 0,
        stockingCount: 0,
        countsByStatus: emptyStatusCounts(),
      };
    }
    const list = giftsBy.get(p.id) ?? [];
    const money = sumMoney(list);
    const countsByStatus = emptyStatusCounts();
    for (const g of list) countsByStatus[g.status]++;
    const b = budgetBy.get(p.id);
    return {
      personId: p.id,
      hidden: false,
      budgetCents: b?.budgetCents ?? 0,
      stockingBudgetCents: b?.stockingBudgetCents ?? 0,
      spentCents: money.spentCents,
      committedCents: money.committedCents,
      giftCount: money.giftCount,
      stockingCount: list.filter((g) => g.category === "stocking" && isCounted(g.status)).length,
      countsByStatus,
    };
  });

  const totalsMoney = sumMoney(seasonGifts);
  const kidIds = new Set(shown.filter((p) => p.kind === "kid").map((p) => p.id));
  const fairness = dashPeople
    .filter((p) => kidIds.has(p.personId) && !p.hidden)
    .map(({ personId, spentCents, committedCents, giftCount }) => ({ personId, spentCents, committedCents, giftCount }));

  const returnsSoon: Dashboard["attention"]["returnsSoon"] = [];
  for (const g of seasonGifts) {
    const level = returnByLevel(g, today);
    if (level && g.returnBy) returnsSoon.push({ giftId: g.id, title: g.title, recipientId: g.recipientId, returnBy: g.returnBy, level });
  }
  returnsSoon.sort((a, b) => a.returnBy.localeCompare(b.returnBy) || a.giftId - b.giftId);

  return {
    season: toSeason(season),
    totals: {
      budgetCents: season.overallBudgetCents,
      spentCents: totalsMoney.spentCents,
      committedCents: totalsMoney.committedCents,
      remainingCents: remainingCents(season.overallBudgetCents, totalsMoney),
      giftCount: totalsMoney.giftCount,
    },
    people: dashPeople,
    fairness,
    attention: {
      returnsSoon,
      orderedNotReceived: seasonGifts
        .filter((g) => g.status === "ordered")
        .map((g) => ({ giftId: g.id, title: g.title, recipientId: g.recipientId, store: g.store })),
      receivedNotWrapped: seasonGifts
        .filter((g) => g.status === "received")
        .map((g) => ({ giftId: g.id, title: g.title, recipientId: g.recipientId })),
    },
  };
}

export const dashboardRoutes = new Hono<AppEnv>();

dashboardRoutes.get("/", async (c) => {
  const { seasonId } = parseQuery(c, dashboardQuery);
  const db = c.var.db;
  let season: SeasonRow | undefined;
  if (seasonId !== undefined) {
    season = await db.select().from(seasons).where(eq(seasons.id, seasonId)).get();
    if (!season) notFound("Season not found");
  } else {
    season = await db.select().from(seasons).where(eq(seasons.isActive, true)).get();
    if (!season) return c.json(emptyDashboard(null));
  }
  return c.json(await buildDashboard(db, c.var.user, c.var.today, season));
});
