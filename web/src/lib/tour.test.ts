import { describe, expect, it } from "vitest";
import {
  buildTourSteps,
  initialTourState,
  markTourDone,
  partnerName,
  shouldAutoStart,
  TOUR_STEP_COUNT,
  tourDoneKey,
  tourReducer,
  type TourAction,
  type TourState,
} from "./tour";

const run = (actions: TourAction[], total = 9, from: TourState = initialTourState) => actions.reduce((s, a) => tourReducer(s, a, total), from);

describe("tourReducer", () => {
  it("starts at step 0", () => {
    expect(run([{ type: "start" }])).toEqual({ status: "running", index: 0 });
  });
  it("next/back move within bounds", () => {
    expect(run([{ type: "start" }, { type: "next" }, { type: "next" }]).index).toBe(2);
    expect(run([{ type: "start" }, { type: "next" }, { type: "back" }]).index).toBe(0);
    expect(run([{ type: "start" }, { type: "back" }, { type: "back" }])).toEqual({ status: "running", index: 0 });
  });
  it("next on the last step finishes", () => {
    const last = run([{ type: "start" }, ...Array.from({ length: 8 }, () => ({ type: "next" }) as const)]);
    expect(last).toEqual({ status: "running", index: 8 });
    expect(tourReducer(last, { type: "next" }, 9)).toEqual({ status: "done", index: 8 });
  });
  it("skip and finish end the tour", () => {
    expect(run([{ type: "start" }, { type: "next" }, { type: "skip" }]).status).toBe("done");
    expect(run([{ type: "start" }, { type: "finish" }]).status).toBe("done");
  });
  it("ignores navigation when not running, and restarts from 0", () => {
    expect(run([{ type: "next" }, { type: "back" }])).toEqual(initialTourState);
    const done = run([{ type: "start" }, { type: "next" }, { type: "skip" }]);
    expect(tourReducer(done, { type: "next" }, 9)).toBe(done);
    expect(tourReducer(done, { type: "start" }, 9)).toEqual({ status: "running", index: 0 });
  });
  it("handles an empty tour", () => {
    expect(tourReducer(initialTourState, { type: "start" }, 0).status).toBe("done");
  });
});

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}
const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("auto-start decision", () => {
  it("starts when the flag is absent", () => {
    expect(shouldAutoStart(memStore(), 7)).toBe(true);
  });
  it("doesn't start when the flag is present for this user", () => {
    expect(shouldAutoStart(memStore({ [tourDoneKey(7)]: "x" }), 7)).toBe(false);
    expect(shouldAutoStart(memStore({ [tourDoneKey(8)]: "x" }), 7)).toBe(true);
  });
  it("doesn't start when storage is missing or throws, or there's no user", () => {
    expect(shouldAutoStart(null, 7)).toBe(false);
    expect(shouldAutoStart(undefined, 7)).toBe(false);
    expect(shouldAutoStart(throwing, 7)).toBe(false);
    expect(shouldAutoStart(memStore(), undefined)).toBe(false);
  });
  it("markTourDone sets the per-user key and never throws", () => {
    const s = memStore();
    markTourDone(s, 7);
    expect(s.m.has("gl.tourDone.7")).toBe(true);
    expect(shouldAutoStart(s, 7)).toBe(false);
    expect(() => markTourDone(throwing, 7)).not.toThrow();
    expect(() => markTourDone(null, 7)).not.toThrow();
  });
});

describe("names", () => {
  const users = [
    { id: 1, displayName: "Jordan", personId: 1 },
    { id: 2, displayName: "Casey", personId: 2 },
  ];
  it("uses the other user's display name", () => {
    expect(partnerName(users, 1)).toBe("Casey");
    expect(partnerName(users, 2)).toBe("Jordan");
  });
  it("falls back to 'your partner'", () => {
    expect(partnerName(undefined, 1)).toBe("your partner");
    expect(partnerName([], 1)).toBe("your partner");
    expect(partnerName([users[0]], 1)).toBe("your partner");
    expect(partnerName([{ id: 2, displayName: "  ", personId: null }], 1)).toBe("your partner");
  });
  it("puts names into the steps", () => {
    const steps = buildTourSteps({ me: "Jordan", other: "Casey" });
    expect(steps).toHaveLength(TOUR_STEP_COUNT);
    expect(TOUR_STEP_COUNT).toBe(9);
    expect(steps[0].title).toContain("Jordan");
    expect(steps[0].body).toContain("Casey");
    expect(steps.find((s) => s.id === "wishlist")!.body).toMatch(/^Add things.*Casey sees them/);
    const fb = buildTourSteps({ me: null, other: "your partner" });
    expect(fb[0].title).toBe("Welcome to Gift List!");
    expect(fb.find((s) => s.id === "wishlist")!.body).toContain("Your partner sees them");
    expect(buildTourSteps({ me: "A", other: "B & C" }).find((s) => s.id === "wishlist")!.body).toContain("B & C see them");
  });
  it("never hard-codes names", () => {
    const text = JSON.stringify(buildTourSteps({ me: "Zed", other: "Quinn" }));
    expect(text).not.toMatch(/Mom|Dad|Darrin|Stephanie/);
  });
});
