// Prompt 437 §D — founder-side advice about Vault access and NDA
// protection. Pure functions, tested — same family as rules.ts (CLAUDE.md:
// "business rules live in rules.ts as pure functions"), own file since
// this is a distinct domain (Vault sharing posture, not outreach
// discipline).
//
// Privacy: this module's OUTPUT (investor names, conversation state,
// access state) is 100% founder-side by construction — it must never reach
// an investor-facing surface. CLAUDE.md's root rule: contact counts and
// outreach pace are derived data about the founder, no toggle.
//
// Prompt 882 — the "in active conversation but no data room access" advice
// left the Vault (documents) and now also renders in the Pipeline summary
// and the investor dossier (entities/[id]). All three are founder-only
// surfaces (the investor-facing surface is /portal, which never imports
// this). The NDA-posture advice stays on the Vault, where document-sharing
// posture belongs. vaultAccessAdviceFromDb centralises the db → input
// mapping so the three callers cannot drift.
import type { Db } from './types';

// Prompt 882 — "A", "A and B", "A, B, and C". Shared by every surface that
// lists the entities this advice names.
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

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

// Prompt 882 — the one place the store is mapped into the advice input, so
// the Vault, the Pipeline summary and the dossier read identical advice.
// Grants are filtered to ACTIVE (not revoked, not expired) — the same set
// documents/page.tsx's visibleGrants uses; a lapsed grant is neither access
// nor NDA coverage. A revoked/expired-only entity therefore still reads as
// "in conversation without access", which is correct.
export function vaultAccessAdviceFromDb(db: Db, now: Date = new Date()): VaultAccessAdvice {
  const activeGrants = db.grants.filter((g) => !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > now));
  return vaultAccessAdvice({
    entities: db.entities.map((e) => ({ id: e.id, name: e.name })),
    interactions: db.interactions.map((i) => ({ entity_id: i.entity_id, at: i.occurred_at, direction: i.direction })),
    grants: activeGrants.map((g) => ({
      person_id: g.person_id ?? null, email: g.grantee_email ?? null,
      folder_id: g.folder_id ?? null, document_id: g.document_id ?? null, nda_required: g.nda_required,
    })),
    people: db.people.map((p) => ({ id: p.id, entity_id: p.entity_id, email: p.email_verified ?? p.email_guess ?? null })),
  }, now);
}
