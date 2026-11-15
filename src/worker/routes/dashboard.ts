import { asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { gifts, people, personBudgets, seasons, type GiftStatus, type SeasonRow } from "../../db/schema";
import { loadVisibleGifts, type GiftWithRecipients } from "../gift-access";
import { notFound, parseQuery } from "../http";
import {
  emptyStatusCounts,
  isCounted,
  isSeasonSecret,
  remainingCents,
  returnByLevel,
  sumMoney,
  sumMoneyFor,
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
  stockingSpentCents: number;
  stockingCommittedCents: number;
  giftCount: number;
  stockingCount: number;
  countsByStatus: Record<GiftStatus, number>;
}

/** How attention items identify a gift and who it's for (recipientId was retired in part C). */
interface AttentionGift {
  giftId: number;
  title: string;
  recipientIds: number[];
  isFamily: boolean;
}

export interface Dashboard {
  season: ApiSeason | null;
  totals: {
    budgetCents: number;
    spentCents: number;
    committedCents: number;
    remainingCents: number;
    giftCount: number;
    /** Sum of person budgets (non-archived, non-giver-only people, viewer included) plus the family budget. */
    allocatedCents: number;
    /** overallBudgetCents − allocatedCents; negative = over-allocated. */
    unallocatedCents: number;
  };
  people: DashboardPerson[];
  /** Family gifts: they count toward the totals once and toward no person. */
  family: { budgetCents: number; spentCents: number; committedCents: number; giftCount: number };
  fairness: { personId: number; spentCents: number; committedCents: number; giftCount: number }[];
  attention: {
    returnsSoon: (AttentionGift & { returnBy: string; level: "amber" | "red" })[];
    orderedNotReceived: (AttentionGift & { store: string })[];
    receivedNotWrapped: AttentionGift[];
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
      allocatedCents: season?.familyBudgetCents ?? 0,
      unallocatedCents: (season?.overallBudgetCents ?? 0) - (season?.familyBudgetCents ?? 0),
    },
    people: [],
    family: { budgetCents: season?.familyBudgetCents ?? 0, spentCents: 0, committedCents: 0, giftCount: 0 },
    fairness: [],
    attention: { returnsSoon: [], orderedNotReceived: [], receivedNotWrapped: [] },
  };
}

function attentionGift(g: GiftWithRecipients): AttentionGift {
  return { giftId: g.id, title: g.title, recipientIds: g.isFamily ? [] : g.recipientIds, isFamily: g.isFamily };
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
  // A multi-person gift is in each recipient's list; family gifts are in nobody's.
  for (const g of seasonGifts) {
    if (g.isFamily) continue;
    for (const personId of g.recipientIds) {
      const list = giftsBy.get(personId) ?? [];
      list.push(g);
      giftsBy.set(personId, list);
    }
  }
  const secret = isSeasonSecret(season, today);

  // Show non-archived parents and kids, plus anyone with a budget or (visible) gifts this season.
  // Giver-only people (gift tags like Santa) never get a card.
  const shown = allPeople.filter(
    (p) =>
      !p.giverOnly &&
      ((!p.archived && p.kind !== "other") ||
        budgetBy.has(p.id) ||
        giftsBy.has(p.id) ||
        (secret && p.id === viewer.personId && !p.archived)),
  );

  // Allocation counts every budget, the viewer's own included (a budget isn't a surprise),
  // plus the family budget.
  const allocatable = new Set(allPeople.filter((p) => !p.archived && !p.giverOnly).map((p) => p.id));
  const allocatedCents = budgets.reduce(
    (sum, b) => (allocatable.has(b.personId) ? sum + b.budgetCents : sum),
    season.familyBudgetCents,
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
        stockingSpentCents: 0,
        stockingCommittedCents: 0,
        giftCount: 0,
        stockingCount: 0,
        countsByStatus: emptyStatusCounts(),
      };
    }
    // Each recipient gets an even share of a multi-person gift (see splitCents).
    const list = giftsBy.get(p.id) ?? [];
    const money = sumMoneyFor(list, p.id);
    const stockingMoney = sumMoneyFor(
      list.filter((g) => g.category === "stocking"),
      p.id,
    );
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
      stockingSpentCents: stockingMoney.spentCents,
      stockingCommittedCents: stockingMoney.committedCents,
      giftCount: money.giftCount,
      stockingCount: list.filter((g) => g.category === "stocking" && isCounted(g.status)).length,
      countsByStatus,
    };
  });

  // Totals count every gift once, at full price.
  const totalsMoney = sumMoney(seasonGifts);
  const familyMoney = sumMoney(seasonGifts.filter((g) => g.isFamily));
  const kidIds = new Set(shown.filter((p) => p.kind === "kid").map((p) => p.id));
  const fairness = dashPeople
    .filter((p) => kidIds.has(p.personId) && !p.hidden)
    .map(({ personId, spentCents, committedCents, giftCount }) => ({ personId, spentCents, committedCents, giftCount }));

  const returnsSoon: Dashboard["attention"]["returnsSoon"] = [];
  for (const g of seasonGifts) {
    const level = returnByLevel(g, today);
    if (level && g.returnBy) returnsSoon.push({ ...attentionGift(g), returnBy: g.returnBy, level });
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
      allocatedCents,
      unallocatedCents: season.overallBudgetCents - allocatedCents,
    },
    people: dashPeople,
    family: {
      budgetCents: season.familyBudgetCents,
      spentCents: familyMoney.spentCents,
      committedCents: familyMoney.committedCents,
      giftCount: familyMoney.giftCount,
    },
    fairness,
    attention: {
      returnsSoon,
      orderedNotReceived: seasonGifts
        .filter((g) => g.status === "ordered")
        .map((g) => ({ ...attentionGift(g), store: g.store })),
      receivedNotWrapped: seasonGifts
        .filter((g) => g.status === "received")
        .map(attentionGift),
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
