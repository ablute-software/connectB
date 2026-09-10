// Prompt 585 §F.9 — the one piece of the contact-outcomes write that's
// worth pulling out as pure, testable logic: deciding whether a founder's
// message should be linked to a recently-used hook suggestion. The I/O
// around it (finding candidate hooks, checking for a prior link) lives in
// postMessage() (src/lib/deal-messages.ts), the one place both a founder
// send and an investor reply already flow through.
export interface UsedHookCandidate { id: string; targetKind: 'person' | 'entity'; targetId: string }

export function deriveContactOutcomeLink(
  usedHook: UsedHookCandidate | null,
  alreadyLinkedToAnOutcome: boolean,
): { hookSuggestionId: string | null; personId: string | null } {
  if (!usedHook || alreadyLinkedToAnOutcome) return { hookSuggestionId: null, personId: null };
  return { hookSuggestionId: usedHook.id, personId: usedHook.targetKind === 'person' ? usedHook.targetId : null };
}
