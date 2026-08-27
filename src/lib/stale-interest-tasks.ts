// Prompt 413 §1 — a task can end up open even though the request that
// created it was already decided: decideInterestLevel3 (investor-interest-
// level-db.ts) only closes the task if it can resolve the request's
// investor to a founder-side entity_id AT DECISION TIME (via
// catalog_deliveries); when that resolution isn't there yet, the close
// step silently no-ops, and — since the request is no longer 'pending' —
// no retry of that same decide ever reaches the close step again. Real
// case, root-caused by SQL: investor_interest_levels 88708f94-… decided
// granted 2026-08-16, task ec5b9041-… still open, entity c8ff10dd-….
//
// This function only ever finds candidates to close; it never decides
// anything about the request itself. Conservative by design: a task whose
// entity has NO known request at all is left exactly as it is (no request
// means no proof either way), and any pending request for that entity
// blocks closing outright, even alongside a decided one for the same
// entity (an unusual shape — multiple catalog entities can resolve to the
// same founder entity_id — but "any pending blocks" is the safe reading).
export interface StaleTaskCandidate {
  id: string;
  entityId: string | null;
  done: boolean;
  source: string;
}

export interface InterestRequestForReconciliation {
  id: string;
  entityId: string | null;
  status: 'pending' | 'granted' | 'denied';
}

export interface StaleInterestTaskMatch {
  taskId: string;
  // The specific decided request that justifies closing this task —
  // carried through for the caller's own audit log (task id + request id).
  requestId: string;
}

export function staleInterestTasks(
  tasks: StaleTaskCandidate[], requests: InterestRequestForReconciliation[],
): StaleInterestTaskMatch[] {
  const matches: StaleInterestTaskMatch[] = [];
  for (const t of tasks) {
    if (t.done || t.source !== 'interest_level_request' || !t.entityId) continue;
    const forEntity = requests.filter((r) => r.entityId === t.entityId);
    if (forEntity.some((r) => r.status === 'pending')) continue;
    const decided = forEntity.find((r) => r.status === 'granted' || r.status === 'denied');
    if (!decided) continue;
    matches.push({ taskId: t.id, requestId: decided.id });
  }
  return matches;
}
