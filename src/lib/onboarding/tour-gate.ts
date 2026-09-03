// Prompt 549 — the single predicate deciding whether a page tour may open.
//
// THE BUG IT CLOSES. The Vault Data Room had two overlays with two
// independent triggers and no awareness of each other. The privacy notice
// (documents/page.tsx) resolves ASYNCHRONOUSLY — a Supabase read, or
// localStorage in demo mode — and only then sets its open state. PageTour
// opened the moment OnboardingProvider's `loaded` flipped, which on a first
// visit is before (or in the same commit as) the notice's fetch resolves.
// The tour's backdrop is z-[60] and the notice's is z-50, so the notice
// then rendered UNDERNEATH a full-screen backdrop and "Got it" could not be
// reached at all.
//
// The inverted z-order is the SYMPTOM, not the cause, which is why this fix
// is state and not stacking: raising the notice above the tour would leave
// two overlays fighting for the same moment, and the next pair would
// collide again. Instead a blocking overlay HOLDS tours while it is up, and
// after this fix the two are never mounted together at all — so the z-order
// stops mattering and is deliberately left alone.
//
// Extracted as a pure function so the four cases are a table test rather
// than a browser check.
export interface TourGateInput {
  /** OnboardingProvider has finished reading its persisted state. */
  loaded: boolean;
  /** Any blocking overlay currently claims priority (provider's toursHeld). */
  held: boolean;
  /** This pageKey is already in `seen`. */
  seen: boolean;
  /** How many steps this pageKey has in TOUR_CONTENT. */
  stepCount: number;
}

export function tourMayOpen({ loaded, held, seen, stepCount }: TourGateInput): boolean {
  return loaded && !held && !seen && stepCount > 0;
}

// ---------------------------------------------------------------------------
// The hold registry's own transitions, pure so they can be tested without a
// DOM (this repository has no jsdom/@testing-library — every test here is a
// pure-function test). OnboardingProvider's holdTours/releaseTours are thin
// wrappers over these, so what is tested is what ships.
//
// Identity matters as much as membership: React state must be REPLACED, not
// mutated, or the provider will not re-render and PageTour never learns the
// hold appeared. Both helpers therefore return the SAME set instance when
// nothing changed, and a new one when it did — which is also what makes a
// repeated hold or a duplicate release free rather than a render loop.

export function addHold(holds: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (holds.has(key)) return holds;
  return new Set(holds).add(key);
}

/** Idempotent: an effect cleanup can fire after the key is already gone. */
export function removeHold(holds: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (!holds.has(key)) return holds;
  const next = new Set(holds);
  next.delete(key);
  return next;
}

export function toursHeld(holds: ReadonlySet<string>): boolean {
  return holds.size > 0;
}
