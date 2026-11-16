import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMe, useUsers } from "../lib/queries";
import {
  browserStorage,
  buildTourSteps,
  initialTourState,
  markTourDone,
  partnerName,
  shouldAutoStart,
  tourReducer,
  type TourAction,
  type TourStep,
} from "../lib/tour";

interface TourCtx {
  start: () => void;
  running: boolean;
}
const Ctx = createContext<TourCtx | null>(null);

/** `start()` restarts the tour (Settings → Take the tour). Null outside the signed-in app. */
export const useTour = () => useContext(Ctx);

const reducer = (s: typeof initialTourState, a: TourAction) => tourReducer(s, a);

/**
 * Mounted inside the signed-in routes only (never on /login). Starts the tour once per user per
 * device: the first time someone is signed in here with no `gl.tourDone.<id>` flag.
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const users = useUsers();
  const [state, dispatch] = useReducer(reducer, initialTourState);
  const userId = me.data?.id;

  const decidedFor = useRef<number | null>(null);
  useEffect(() => {
    if (userId == null || decidedFor.current === userId) return;
    decidedFor.current = userId;
    if (shouldAutoStart(browserStorage(), userId)) dispatch({ type: "start" });
  }, [userId]);

  const prevStatus = useRef(state.status);
  useEffect(() => {
    if (prevStatus.current === "running" && state.status === "done") markTourDone(browserStorage(), userId);
    prevStatus.current = state.status;
  }, [state.status, userId]);

  const steps = useMemo(
    () => buildTourSteps({ me: me.data?.displayName ?? null, other: partnerName(users.data, userId) }),
    [me.data?.displayName, users.data, userId],
  );
  const start = useCallback(() => dispatch({ type: "start" }), []);
  const running = state.status === "running";
  const value = useMemo(() => ({ start, running }), [start, running]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {running && <TourOverlay steps={steps} index={state.index} dispatch={dispatch} />}
    </Ctx.Provider>
  );
}

/** The first element with this data-tour value that is actually rendered (desktop vs mobile nav). */
function findVisible(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

function useIsDesktop() {
  const q = "(min-width: 768px)";
  const [v, setV] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setV(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return v;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}
const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);
const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** `b` limited to the vertical band [top, bottom]. */
function clip(b: Box, top: number, bottom: number): Box {
  const t = Math.max(b.top, top);
  return { ...b, top: t, height: Math.max(0, Math.min(b.top + b.height, bottom) - t) };
}

const PAD = 6;
const HEADER = 72; // sticky header + a little air
const TABBAR = 61; // mobile bottom tabs (60px + border)
const GAP = 10;

function TourOverlay({ steps, index, dispatch }: { steps: TourStep[]; index: number; dispatch: (a: TourAction) => void }) {
  const step = steps[index];
  const total = steps.length;
  const last = index === total - 1;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const desktop = useIsDesktop();
  const cardRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(0);
  const handled = useRef<string | null>(null);

  // Go to the step's page. Replace, so Back in the browser isn't full of tour stops.
  useEffect(() => {
    if (step.route && window.location.pathname !== step.route) navigate(step.route, { replace: true });
  }, [step.route, step.id, navigate]);

  // Focus the card on every step.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [index]);

  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight ?? 0;
    if (h !== cardH) setCardH(h);
  });

  // Find, scroll to and track the highlighted element. It may appear late (data loading),
  // move (layout shifts, scrolling, resize) or never exist (empty states): poll lightly.
  useEffect(() => {
    let raf = 0;
    handled.current = null;
    const measure = () => {
      const el = step.target ? findVisible(step.target) : null;
      if (!el) return setBox((b) => (b === null ? b : null));
      if (handled.current !== step.id) {
        handled.current = step.id;
        const r = el.getBoundingClientRect();
        const cardTop = desktop ? window.innerHeight : window.innerHeight - TABBAR - 8 - (cardRef.current?.offsetHeight ?? 0);
        const fixed = !!el.closest("nav, header");
        if (!fixed && (r.top < HEADER || r.bottom > cardTop - GAP)) el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
        // Pages can autofocus a field after mounting; keep focus on the tour card.
        if (cardRef.current && !cardRef.current.contains(document.activeElement)) cardRef.current.focus({ preventScroll: true });
      }
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const left = Math.max(2, r.left - PAD);
      const right = Math.min(vw - 2, r.right + PAD);
      const next = { top: r.top - PAD, left, width: Math.max(0, right - left), height: r.height + PAD * 2 };
      setBox((b) => (sameBox(b, next) ? b : next));
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    schedule();
    const iv = window.setInterval(measure, 250);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(iv);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [step.id, step.target, pathname, desktop]);

  // Keys win over the page (e.g. a sheet's own Escape): capture phase on window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === "Escape") dispatch({ type: "skip" });
      else if (e.key === "ArrowRight" && !typing) dispatch({ type: "next" });
      else if (e.key === "ArrowLeft" && !typing) dispatch({ type: "back" });
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dispatch]);

  // Where the card goes: centered with no highlight; above the tab bar on phones (or below the
  // header if the target sits behind it); on desktop, the first corner that doesn't cover it.
  const vw = typeof window !== "undefined" ? document.documentElement.clientWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  let cardStyle: CSSProperties;
  let cardClass: string;
  // The ring stays on screen: clipped at the viewport edges and, on phones, above the card
  // (a tall section like Budgets is outlined only where it can be seen).
  let ring = box;
  if (!box) {
    cardClass = "left-1/2 top-1/2 w-[min(400px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2";
    cardStyle = {};
  } else if (!desktop) {
    const bottom = TABBAR + 8;
    const cardTop = vh - bottom - cardH;
    // Below the card (the tab bar) is fine; starting behind the card is not.
    const below = box.top >= vh - bottom - PAD - 2;
    const behind = !below && box.top >= cardTop - 24;
    cardClass = "inset-x-3";
    const clipBottom = behind || below ? vh - 2 : Math.max(box.top + 40, cardTop - GAP);
    ring = clip(box, 2, clipBottom);
    cardStyle = behind ? { top: `calc(${HEADER - 8}px + env(safe-area-inset-top))` } : { bottom: `calc(${bottom}px + env(safe-area-inset-bottom))` };
  } else {
    const w = 360;
    const m = 24;
    const h = cardH || 220;
    const corners: { style: CSSProperties; rect: Box }[] = [
      { style: { right: m, bottom: m }, rect: { left: vw - m - w, top: vh - m - h, width: w, height: h } },
      { style: { left: m, bottom: m }, rect: { left: m, top: vh - m - h, width: w, height: h } },
      { style: { right: m, top: HEADER + 16 }, rect: { left: vw - m - w, top: HEADER + 16, width: w, height: h } },
      { style: { left: m, top: HEADER + 16 }, rect: { left: m, top: HEADER + 16, width: w, height: h } },
    ];
    ring = clip(box, 2, vh - 2);
    cardClass = "w-[360px]";
    cardStyle = (corners.find((c) => !overlaps(c.rect, box)) ?? corners[0]).style;
  }

  return (
    <div className="tour" data-tour-open="">
      {/* Blocks taps on the page while touring, so nothing changes by accident. */}
      <div className={`fixed inset-0 z-[60] ${box ? "" : "bg-[rgb(8_16_12/0.5)]"}`} aria-hidden="true" onClick={(e) => e.preventDefault()} />
      {ring && (
        <div
          className="tour-ring pointer-events-none fixed z-[61] rounded-2xl"
          style={{ top: ring.top, left: ring.left, width: ring.width, height: ring.height }}
          aria-hidden="true"
          data-tour-ring={step.target}
        />
      )}
      <div
        key={index}
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className={`tour-card sheet-in fixed z-[62] rounded-2xl border border-line bg-surface p-5 text-ink shadow-[0_18px_48px_-12px_rgba(0,0,0,0.45)] outline-none ${cardClass}`}
        style={cardStyle}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="tnum text-[13px] font-semibold text-muted">
            {index + 1} of {total}
          </span>
          <span className="flex items-center gap-1" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.id} className="h-1.5 rounded-full transition-all" style={{ width: i === index ? 16 : 6, background: i <= index ? "var(--pine)" : "var(--line)" }} />
            ))}
          </span>
        </div>
        <h2 id="tour-title" className="mt-2 text-[21px] font-extrabold leading-tight tracking-[-0.01em] [font-stretch:94%]">
          {step.title}
        </h2>
        <p id="tour-body" className="mt-1.5 text-[15px] leading-snug">
          {step.body}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button type="button" className="-ml-2 min-h-[44px] rounded-xl px-2 text-[15px] font-semibold text-muted hover:text-ink" onClick={() => dispatch({ type: "skip" })}>
            Skip tour
          </button>
          <span className="flex-1" />
          {index > 0 && (
            <button type="button" className="btn-quiet min-h-[44px] !px-4" onClick={() => dispatch({ type: "back" })}>
              Back
            </button>
          )}
          <button type="button" className="btn-primary min-h-[44px] !px-5" onClick={() => dispatch({ type: last ? "finish" : "next" })}>
            {last ? "Finish" : "Next"}
          </button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {`Step ${index + 1} of ${total}: ${step.title}. ${step.body}`}
      </p>
    </div>
  );
}
