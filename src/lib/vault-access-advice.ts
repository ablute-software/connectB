// Prompt 437 §D — founder-side advice about Vault access and NDA
// protection. Pure functions, tested — same family as rules.ts (CLAUDE.md:
// "business rules live in rules.ts as pure functions"), own file since
// this is a distinct domain (Vault sharing posture, not outreach
// discipline).
//
// Privacy: this module's OUTPUT (investor names, conversation state,
// access state) is 100% founder-side by construction — it exists to
// render a card on the founder's own /documents page and must never reach
// an investor-facing surface. CLAUDE.md's root rule: contact counts and
// outreach pace are derived data about the founder, no toggle. Enforced
// by never calling this from anything but documents/page.tsx.

export interface VaultAccessAdviceInput {
  entities: { id: string; name: string }[];
  interactions: { entity_id: string; at: string; direction: string }[];
  // Active grants only (not revoked, not expired) — filtering that out is
  // the caller's job, same as documents/page.tsx's own visibleGrants; this
  // function doesn't need to know revocation semantics to give advice.
  grants: {
    person_id?: string | null; email?: string | null; folder_id?: string | null;
    document_id?: string | null; nda_required: boolean;
  }[];
  people: { id: string; entity_id: string | null; email: string | null }[];
}

export interface VaultAccessAdvice {
  inConversationWithoutAccess: { entityId: string; name: string }[];
  hasNoNdaProtectedDocuments: boolean;
}

const CONVERSATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function vaultAccessAdvice(input: VaultAccessAdviceInput, now: Date = new Date()): VaultAccessAdvice {
  const cutoff = now.getTime() - CONVERSATION_WINDOW_MS;

  // Grants carry person_id/email, never entity_id directly — resolve via
  // people to the set of entities that already have at least one grant.
  const personById = new Map(input.people.map((p) => [p.id, p]));
  const emailToEntityIds = new Map<string, Set<string>>();
  for (const p of input.people) {
    if (!p.entity_id || !p.email) continue;
    const key = p.email.toLowerCase();
    if (!emailToEntityIds.has(key)) emailToEntityIds.set(key, new Set());
    emailToEntityIds.get(key)!.add(p.entity_id);
  }
  const entityIdsWithGrant = new Set<string>();
  for (const g of input.grants) {
    const viaPerson = g.person_id ? personById.get(g.person_id)?.entity_id : null;
    if (viaPerson) entityIdsWithGrant.add(viaPerson);
    const viaEmail = g.email ? emailToEntityIds.get(g.email.toLowerCase()) : null;
    if (viaEmail) for (const id of viaEmail) entityIdsWithGrant.add(id);
  }

  // "Direct conversation" = at least one inbound AND one outbound
  // interaction in the last 30 days. An outbound-only sequence (never
  // answered) is not a conversation — advising to open the Vault to
  // someone who never replied would be bad advice.
  const inConversationWithoutAccess: { entityId: string; name: string }[] = [];
  for (const entity of input.entities) {
    if (entityIdsWithGrant.has(entity.id)) continue;
    const recent = input.interactions.filter((i) => i.entity_id === entity.id && new Date(i.at).getTime() >= cutoff);
    const hasInbound = recent.some((i) => i.direction === 'in');
    const hasOutbound = recent.some((i) => i.direction === 'out');
    if (hasInbound && hasOutbound) inConversationWithoutAccess.push({ entityId: entity.id, name: entity.name });
  }

  const hasNoNdaProtectedDocuments = input.grants.length > 0 && !input.grants.some((g) => g.nda_required);

  return { inConversationWithoutAccess, hasNoNdaProtectedDocuments };
}
