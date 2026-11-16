// First-run guided tour: step content, a small state machine, and the per-user "done" flag.
// Names always come from data (the signed-in user and GET /users), never hard-coded.
import type { UserSummary } from "../api";
import { otherUsersLabel } from "./wishlist";

export interface TourStep {
  id: string;
  /** Route to show for this step (navigated to with replace). */
  route?: string;
  /** Value of a `data-tour` attribute to highlight. Missing/hidden → card shown without a highlight. */
  target?: string;
  title: string;
  body: string;
}

export interface TourNames {
  /** The signed-in user's display name, or null. */
  me: string | null;
  /** The other user(s) ("Sam", "Sam & Alex"), or "your partner". */
  other: string;
}

export const PARTNER_FALLBACK = "your partner";

/** The other signed-in user's name(s), falling back to "your partner". */
export function partnerName(users: readonly UserSummary[] | undefined, meId: number | undefined): string {
  return otherUsersLabel(users ?? [], meId) ?? PARTNER_FALLBACK;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sees = (who: string) => (who.includes("&") ? "see" : "sees");

export function buildTourSteps({ me, other }: TourNames): TourStep[] {
  const name = me?.trim();
  return [
    {
      id: "welcome",
      route: "/",
      title: name ? `Welcome, ${name}!` : "Welcome to Gift List!",
      body: `This is where you and ${other} plan the season's gifts: ideas, budgets, shopping and wrapping. Anything meant for you is hidden from you, so surprises stay surprises.`,
    },
    {
      id: "dashboard",
      route: "/",
      target: "pot",
      title: "Your dashboard",
      body: "The shared pot shows what's spent, committed to planned gifts and still remaining, and how much is allocated per person. Below it, Needs attention flags orders to chase and gifts to wrap, and Fairness keeps the kids even.",
    },
    {
      id: "gifts",
      route: "/gifts",
      target: "gift-status",
      title: "Gifts, one tap at a time",
      body: "Tap Add gift to jot down an idea. One tap moves it along: idea → planned → ordered → received → wrapped → given. Switch between cards and a table, and narrow things down with these status chips and Filters.",
    },
    {
      id: "for-from",
      route: "/gifts/new",
      target: "for",
      title: "For & From",
      body: "A gift can be for several people; the cost is split across their budgets. 🏠 Whole family gifts are visible to both of you, and Santa is just a “From” tag. Gifts for you are always hidden from you.",
    },
    {
      id: "lists",
      route: "/lists",
      target: "nav-lists",
      title: "Lists for busy days",
      body: "A shopping list grouped by store, Wrapping & Christmas Eve, a givers checklist, the name draw, a year-round ideas inbox, and recent activity.",
    },
    {
      id: "wishlist",
      route: "/lists",
      target: "wishlist-tile",
      title: "My wishlist",
      body: `Add things you'd love. ${cap(other)} ${sees(other)} them; you'll never see whether they were bought.`,
    },
    {
      id: "people",
      route: "/people",
      target: "nav-people",
      title: "People",
      body: "Keep each kid's sizes, likes and birthday here. When a birthday comes up, open them and tap Plan birthday to start a season for it.",
    },
    {
      id: "settings",
      route: "/settings",
      target: "budgets",
      title: "Settings",
      body: "Set budgets per person, including a Family row for shared gifts. Pick a theme, import or export CSV, and add Face ID or a passkey for faster sign-in.",
    },
    {
      id: "done",
      route: "/settings",
      target: "take-tour",
      title: "You're all set",
      body: "That's the tour. You can take it again anytime from Settings with “Take the tour”.",
    },
  ];
}

export const TOUR_STEP_COUNT = buildTourSteps({ me: null, other: PARTNER_FALLBACK }).length;

// ---- State machine ----

export type TourStatus = "idle" | "running" | "done";
export interface TourState {
  status: TourStatus;
  index: number;
}
export type TourAction = { type: "start" } | { type: "next" } | { type: "back" } | { type: "skip" } | { type: "finish" };

export const initialTourState: TourState = { status: "idle", index: 0 };

export function tourReducer(state: TourState, action: TourAction, total: number = TOUR_STEP_COUNT): TourState {
  if (action.type === "start") return { status: total > 0 ? "running" : "done", index: 0 };
  if (state.status !== "running") return state;
  switch (action.type) {
    case "next":
      return state.index >= total - 1 ? { status: "done", index: state.index } : { ...state, index: state.index + 1 };
    case "back":
      return state.index <= 0 ? state : { ...state, index: state.index - 1 };
    case "skip":
    case "finish":
      return { ...state, status: "done" };
  }
}

// ---- Per-user done flag (localStorage) ----

type Store = Pick<Storage, "getItem" | "setItem">;

export const tourDoneKey = (userId: number) => `gl.tourDone.${userId}`;

/** The browser's localStorage, or null when unavailable (accessing it can throw). */
export function browserStorage(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Start automatically only when storage works and has no done flag for this user. */
export function shouldAutoStart(storage: Store | null | undefined, userId: number | null | undefined): boolean {
  if (!storage || userId == null) return false;
  try {
    return storage.getItem(tourDoneKey(userId)) === null;
  } catch {
    return false;
  }
}

export function markTourDone(storage: Store | null | undefined, userId: number | null | undefined): void {
  if (!storage || userId == null) return;
  try {
    storage.setItem(tourDoneKey(userId), new Date().toISOString());
  } catch {
    /* ignore */
  }
}
