// Kids' name draw: a random derangement (nobody draws themselves), optionally avoiding
// last season's pairings. Randomness comes from crypto.getRandomValues.

export interface DrawPair {
  giverId: number;
  recipientId: number;
}

export interface DrawResult {
  pairs: DrawPair[];
  /** Set when the avoid-previous constraint couldn't be met and the draw fell back to a plain derangement. */
  note?: string;
}

/** A uniform integer in [0, n) from crypto.getRandomValues (rejection sampling, no modulo bias). */
export function randomInt(n: number, random: (buf: Uint32Array) => Uint32Array = (b) => crypto.getRandomValues(b)): number {
  if (!Number.isInteger(n) || n <= 0 || n > 0x1_0000_0000) throw new RangeError("randomInt: bad range");
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    random(buf);
    if (buf[0]! < limit) return buf[0]! % n;
  }
}

export function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

type Forbidden = ReadonlyMap<number, number>; // giver -> recipient to avoid

function allowed(giver: number, recipient: number, avoid: Forbidden): boolean {
  return giver !== recipient && avoid.get(giver) !== recipient;
}

const SAMPLE_ATTEMPTS = 200;

/**
 * One random assignment satisfying the constraints, or null if none exists.
 * Rejection sampling (uniform) first; a randomized backtracking search settles small or
 * tightly constrained cases exactly.
 */
function assign(ids: readonly number[], avoid: Forbidden): number[] | null {
  for (let attempt = 0; attempt < SAMPLE_ATTEMPTS; attempt++) {
    const perm = shuffle(ids);
    if (ids.every((g, i) => allowed(g, perm[i]!, avoid))) return perm;
  }
  const used = new Set<number>();
  const out: number[] = [];
  const search = (i: number): boolean => {
    if (i === ids.length) return true;
    for (const r of shuffle(ids)) {
      if (used.has(r) || !allowed(ids[i]!, r, avoid)) continue;
      used.add(r);
      out.push(r);
      if (search(i + 1)) return true;
      used.delete(r);
      out.pop();
    }
    return false;
  };
  return search(0) ? out : null;
}

export const DRAW_FALLBACK_NOTE = "Couldn't avoid every pairing from last time, so some may repeat.";

/**
 * Draws names for `participantIds` (at least 2, unique). `previous` holds last season's
 * pairings to avoid, if any.
 */
export function drawNames(participantIds: readonly number[], previous: readonly DrawPair[] = []): DrawResult {
  const ids = [...new Set(participantIds)];
  if (ids.length < 2) throw new RangeError("At least 2 participants are needed");
  const avoid = new Map(previous.map((p) => [p.giverId, p.recipientId]));
  let perm = previous.length ? assign(ids, avoid) : null;
  let note: string | undefined;
  if (!perm) {
    if (previous.length) note = DRAW_FALLBACK_NOTE;
    perm = assign(ids, new Map())!; // a derangement always exists for n >= 2
  }
  const pairs = ids.map((giverId, i) => ({ giverId, recipientId: perm[i]! }));
  return note ? { pairs, note } : { pairs };
}
