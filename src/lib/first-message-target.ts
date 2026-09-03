// Prompt 544 Part D — the Next Clue stops telling the founder to write to
// nobody.
//
// Step 9 (`onboarding_first_message`) picked `db.entities` sorted by wave then
// fit and always said "Next: send your first message to X". For Sherlock Deal
// that produced "send your first message to Hoxton Ventures" — an entity with
// zero people, where preflight() refuses the draft for lack of a researched
// hook. The founder was sent to a dead end by the one line meant to tell them
// what to do next.
//
// Two rules, both pure so they can be argued with in a test:
//   1. Never choose an entity with nothing to act on.
//   2. Say the step that is actually available, not the one three steps ahead.

export type FirstMessageState = 'has_hook' | 'has_people' | 'channel_only';

export interface FirstMessageCandidate {
  id: string;
  name: string;
  wave?: number;
  fitRank: number;
  /** outreach_readiness from the linked catalog row; 0 when unknown. */
  readiness: number;
  /** Contact people the founder already has on this entity. */
  peopleCount: number;
  /** At least one of those people carries a researched hook. */
  hasHook: boolean;
  /** A submission form or a general inbox exists. */
  hasChannel: boolean;
}

export interface FirstMessageTarget {
  entity: FirstMessageCandidate;
  state: FirstMessageState;
  label: string;
  /** Where the clue's button goes. */
  target: string;
}

/**
 * Can the founder do anything at all with this row today?
 *
 * A person to approach, or a channel to submit through. An entity with
 * neither is not a next step — it is a research task the platform has not
 * finished, and putting it here would blame the founder for it.
 */
export function isActionable(c: FirstMessageCandidate): boolean {
  return c.peopleCount > 0 || c.hasChannel;
}

function stateOf(c: FirstMessageCandidate): FirstMessageState {
  if (c.hasHook) return 'has_hook';
  if (c.peopleCount > 0) return 'has_people';
  return 'channel_only';
}

/**
 * Wave first, then readiness, then fit.
 *
 * Readiness sits above fit deliberately: among firms the founder is meant to
 * approach now, the one they CAN approach beats the one that scores half a
 * point higher and has nobody listed.
 */
export function rankCandidates(candidates: FirstMessageCandidate[]): FirstMessageCandidate[] {
  return [...candidates].sort((a, b) =>
    (a.wave ?? 9) - (b.wave ?? 9)
    || b.readiness - a.readiness
    || a.fitRank - b.fitRank
    || a.name.localeCompare(b.name));
}

export function chooseFirstMessageTarget(
  candidates: FirstMessageCandidate[],
): FirstMessageTarget | null {
  const actionable = rankCandidates(candidates.filter(isActionable));
  const entity = actionable[0];
  if (!entity) return null;

  const state = stateOf(entity);
  if (state === 'has_hook') {
    return {
      entity, state,
      label: `Next: send your first message to ${entity.name}`,
      target: `/entities/${entity.id}?rail=log`,
    };
  }
  if (state === 'has_people') {
    // The real next step: choose who, and write the hook preflight will ask
    // for. Lands on the People tab, which already lists them with LinkedIn.
    return {
      entity, state,
      label: `Next: pick the right partner at ${entity.name} and write your hook`,
      target: `/entities/${entity.id}?tab=people`,
    };
  }
  return {
    entity, state,
    label: `Next: submit to ${entity.name} through their form`,
    target: `/entities/${entity.id}`,
  };
}

/**
 * The task title for a freshly delivered W1 row, mirroring the Next Clue.
 *
 * Prompt 544 Part D — every delivered row arrived with an empty "Next action"
 * column, so the pipeline looked like a list of names with nothing asked of
 * the founder. One task per wave-1 row fixes that on day one, and it says the
 * same sentence the clue would: a task that contradicts the clue is worse
 * than no task.
 *
 * At delivery there are never contact people yet (they are the founder's own
 * rows, created later), so 'has_hook' cannot occur here — hence only the two
 * reachable states.
 */
export function firstStepTaskTitle(name: string, hasPeople: boolean): string {
  return hasPeople
    ? `Pick the right partner at ${name} and write your hook`
    : `Submit to ${name} through their form`;
}
