// Prompt 388 §C.1 — constant-sum weight redistribution: drag one criterion,
// the others move to compensate, the total across all of them never
// changes. Pure/tested on purpose, same discipline as roadmap-canvas.ts —
// the component only turns this into pixels and a drag handler.
//
// Nuno's own acceptance test, verbatim: 6 criteria at 5 each (sum 30),
// drag Team to 10 (+5) makes the other 5 drop to 4 each (-1 each, sum
// still 30). See investor-scorecard-weights.test.ts for that exact case.
export interface WeightedCriterion { id: string; weight: number }

const MIN_WEIGHT = 0;
const MAX_WEIGHT = 10;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// The water-filling core: distribute `amount` (+ or -) across `items`
// (id -> current weight), each bounded to [MIN_WEIGHT, MAX_WEIGHT], giving
// every item an equal share of whatever's left to distribute at each pass —
// an item that hits its own floor/ceiling drops out and the remainder
// re-splits across whichever items still have room. Terminates because
// each pass either fully distributes the amount or clamps at least one more
// item permanently. Returns the exact new weight for every id, and however
// much of `amount` could NOT be placed (0 unless every item is already at
// the relevant bound).
function waterFill(items: Map<string, number>, amount: number): { result: Map<string, number>; unplaced: number } {
  const result = new Map(items);
  let remaining = amount;
  let active = new Set(items.keys());

  while (Math.abs(remaining) > 1e-9 && active.size > 0) {
    const share = remaining / active.size;
    let distributedThisPass = 0;
    const stillActive = new Set<string>();
    for (const id of active) {
      const current = result.get(id) as number;
      const target = clamp(current + share, MIN_WEIGHT, MAX_WEIGHT);
      const actual = target - current;
      result.set(id, target);
      distributedThisPass += actual;
      // Room left in the direction we're pushing -> stays active for the
      // next pass (matters when different items clamp at different times).
      const hasRoom = share > 0 ? target < MAX_WEIGHT - 1e-9 : target > MIN_WEIGHT + 1e-9;
      if (hasRoom) stillActive.add(id);
    }
    remaining -= distributedThisPass;
    if (stillActive.size === active.size && Math.abs(distributedThisPass) < 1e-9) break; // no one has room at all
    active = stillActive;
  }
  return { result, unplaced: remaining };
}

// Largest-remainder rounding: rounds every value to an integer while
// keeping the group's total exactly equal to the (integer) total of the
// unrounded values — plain per-item Math.round() would drift the sum by a
// point or two whenever the split doesn't divide evenly, which is exactly
// what would silently break "manter o total constante" the moment a
// criterion count doesn't divide the delta cleanly (5 others sharing -7,
// say).
function roundKeepingSum(values: Map<string, number>): Map<string, number> {
  const floors = new Map<string, number>();
  const remainders: { id: string; r: number }[] = [];
  let flooredTotal = 0;
  let exactTotal = 0;
  for (const [id, v] of values) {
    const f = Math.floor(v);
    floors.set(id, f);
    remainders.push({ id, r: v - f });
    flooredTotal += f;
    exactTotal += v;
  }
  let toDistribute = Math.round(exactTotal) - flooredTotal;
  remainders.sort((a, b) => b.r - a.r);
  const out = new Map(floors);
  for (let i = 0; i < remainders.length && toDistribute > 0; i++, toDistribute--) {
    out.set(remainders[i].id, (out.get(remainders[i].id) as number) + 1);
  }
  return out;
}

// The drag handler's own entry point: `criteria` is the full current set,
// `changedId` is whichever one is being dragged, `rawTarget` is wherever
// the pointer is (unclamped — this function owns clamping, both the
// dragged criterion's own [0,10] and how much the others can actually
// absorb without going negative or past 10 themselves).
export function redistributeWeight(criteria: WeightedCriterion[], changedId: string, rawTarget: number): WeightedCriterion[] {
  const changed = criteria.find((c) => c.id === changedId);
  if (!changed || criteria.length <= 1) {
    return criteria.map((c) => (c.id === changedId ? { ...c, weight: clamp(Math.round(rawTarget), MIN_WEIGHT, MAX_WEIGHT) } : c));
  }
  const target = clamp(rawTarget, MIN_WEIGHT, MAX_WEIGHT);
  const delta = target - changed.weight;
  if (Math.abs(delta) < 1e-9) return criteria.map((c) => ({ ...c }));

  const others = new Map(criteria.filter((c) => c.id !== changedId).map((c) => [c.id, c.weight]));
  // Others must absorb exactly -delta collectively; whatever they can't
  // (every one of them already pinned at the relevant bound) reduces the
  // dragged criterion's OWN achievable change by the same amount — the
  // sum is constant even in the infeasible-request case, it just means
  // the drag itself goes less far than the pointer asked for.
  const { result: newOthers, unplaced } = waterFill(others, -delta);
  const achievedDelta = delta + unplaced; // unplaced carries the sign of what others couldn't take
  const roundedOthers = roundKeepingSum(newOthers);

  const newChangedWeight = clamp(Math.round(changed.weight + achievedDelta), MIN_WEIGHT, MAX_WEIGHT);
  return criteria.map((c) => (c.id === changedId ? { ...c, weight: newChangedWeight } : { ...c, weight: roundedOthers.get(c.id) as number }));
}

// §C.1 — "Acrescentar um critério novo entra a 5... o total sobe
// naturalmente." No redistribution: every existing weight is untouched,
// the new one just joins at the scale's own midpoint.
export const DEFAULT_NEW_CRITERION_WEIGHT = 5;

// §C.1 — "Remover um critério: redistribuir o que ele tinha pelos
// restantes." The removed criterion's own weight is treated as a positive
// amount to water-fill across whoever's left, same bounded/spillover logic
// as a drag — never just deleted into thin air, never dumped entirely onto
// one neighbor if others have more room.
export function redistributeAfterRemoval(criteria: WeightedCriterion[], removedId: string): WeightedCriterion[] {
  const removed = criteria.find((c) => c.id === removedId);
  const remaining = criteria.filter((c) => c.id !== removedId);
  if (!removed || remaining.length === 0) return remaining;
  const others = new Map(remaining.map((c) => [c.id, c.weight]));
  const { result } = waterFill(others, removed.weight);
  const rounded = roundKeepingSum(result);
  return remaining.map((c) => ({ ...c, weight: rounded.get(c.id) as number }));
}
