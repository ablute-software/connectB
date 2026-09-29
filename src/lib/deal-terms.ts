// Prompt 894 — "Terms on the table": pure rules for negotiated deal
// conditions with memory, a lock/confirm flow, and an archived closing
// memo. Kept pure and framework-free like rules.ts/round-capital.ts/
// composer.ts — the store (store-demo.tsx / store-supabase.tsx) and the UI
// (TermsOnTheTable.tsx) both call into this instead of reimplementing the
// supersession/lock logic twice.
import type { DealTerm, Entity, Interaction, Person } from './types';

// ---------------------------------------------------------------------------
// §A — supersession chain: a term's "current" value is whichever row
// nothing else supersedes. Multiple independent chains can coexist for the
// same entity (one per topic — a valuation chain, a ticket_range chain, a
// commitment chain, etc.) — this is kind-agnostic on purpose, mirroring the
// migration's own trigger logic exactly (deal_terms_sync_interest in
// 20260929200000_deal_terms.sql picks the latest non-superseded
// kind='commitment' row the same way).
export function currentTermsForEntity(terms: DealTerm[], entityId: string): DealTerm[] {
  const all = terms.filter((t) => t.entity_id === entityId);
  const superseded = new Set(all.map((t) => t.supersedes_id).filter(Boolean) as string[]);
  return all.filter((t) => !superseded.has(t.id)).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
}

// The full chain a given (current) term belongs to, oldest first — used by
// the "Edit history" affordance and the deal memo's own supersession list.
export function chainForTerm(terms: DealTerm[], headId: string): DealTerm[] {
  const byId = new Map(terms.map((t) => [t.id, t]));
  const chain: DealTerm[] = [];
  let cur = byId.get(headId);
  while (cur) {
    chain.unshift(cur);
    cur = cur.supersedes_id ? byId.get(cur.supersedes_id) : undefined;
  }
  return chain;
}

// §A — entities.interest_eur mirror, for the demo-mode store (no DB trigger
// exists there) and for the Supabase store's own optimistic local update
// (the DB trigger is still the real source of truth once persisted — this
// only keeps the client's copy of `db.entities` from looking stale between
// a write and the next refetch). MUST match
// public.deal_terms_sync_interest()'s SQL exactly: latest (by recorded_at)
// non-superseded kind='commitment' row for this entity, or undefined.
export function deriveInterestEur(terms: DealTerm[], entityId: string): number | undefined {
  const commitments = currentTermsForEntity(terms, entityId).filter((t) => t.kind === 'commitment');
  return commitments[0]?.amount_eur ?? undefined;
}

// ---------------------------------------------------------------------------
// §C — Lock terms preconditions: "activo quando existe >= 1 termo e nenhum
// está negotiating. Ao carregar: lista as condições agreed (as mentioned
// ficam de fora e o founder é avisado de quais)."
export interface LockPrecheck {
  canLock: boolean;
  blockedReason?: string;
  agreedTerms: DealTerm[];
  mentionedTerms: DealTerm[];
  negotiatingTerms: DealTerm[];
}

export function checkLockPreconditions(terms: DealTerm[], entityId: string): LockPrecheck {
  const current = currentTermsForEntity(terms, entityId);
  const agreedTerms = current.filter((t) => t.formality === 'agreed');
  const mentionedTerms = current.filter((t) => t.formality === 'mentioned');
  const negotiatingTerms = current.filter((t) => t.formality === 'negotiating');
  if (current.length === 0) {
    return { canLock: false, blockedReason: 'No terms recorded yet — add at least one before locking.', agreedTerms, mentionedTerms, negotiatingTerms };
  }
  if (negotiatingTerms.length > 0) {
    return {
      canLock: false,
      blockedReason: `${negotiatingTerms.length} term${negotiatingTerms.length > 1 ? 's are' : ' is'} still Negotiating — resolve or mark Agreed/Mentioned first.`,
      agreedTerms, mentionedTerms, negotiatingTerms,
    };
  }
  return { canLock: true, agreedTerms, mentionedTerms, negotiatingTerms };
}

// ---------------------------------------------------------------------------
// §C — the archived deal memo's structured payload ("para uso por máquina")
// plus a short, code-generated (never AI — §F is explicit) summary for the
// document's own `notes` column. Pure: takes only the slices of Db it
// needs, so it's testable without constructing a whole seeded store.
export interface DealMemoPayload {
  entityId: string;
  entityName: string;
  generatedAt: string;
  people: { id: string; fullName: string; role?: string }[];
  terms: {
    id: string; kind: DealTerm['kind']; side: DealTerm['side']; formality: DealTerm['formality'];
    amountEur?: number; text?: string; recordedAt: string; effectiveAt?: string; agreedAt?: string;
    personName?: string; supersedes: { id: string; amountEur?: number; text?: string; formality: DealTerm['formality']; recordedAt: string }[];
  }[];
  referencedInteractions: { id: string; occurredAt: string; channel: string; direction: string; personName?: string; excerpt: string }[];
}

export function buildDealMemoPayload(
  entity: Pick<Entity, 'id' | 'name'>,
  currentTerms: DealTerm[],
  allTerms: DealTerm[],
  people: Pick<Person, 'id' | 'full_name' | 'role'>[],
  interactions: Pick<Interaction, 'id' | 'occurred_at' | 'channel' | 'direction' | 'person_id' | 'content'>[],
): DealMemoPayload {
  const personById = new Map(people.map((p) => [p.id, p]));
  const referencedInteractionIds = new Set(currentTerms.map((t) => t.interaction_id).filter(Boolean) as string[]);
  return {
    entityId: entity.id,
    entityName: entity.name,
    generatedAt: new Date().toISOString(),
    people: people.map((p) => ({ id: p.id, fullName: p.full_name, role: p.role })),
    terms: currentTerms.map((t) => ({
      id: t.id, kind: t.kind, side: t.side, formality: t.formality, amountEur: t.amount_eur, text: t.text,
      recordedAt: t.recorded_at, effectiveAt: t.effective_at, agreedAt: t.agreed_at,
      personName: t.person_id ? personById.get(t.person_id)?.full_name : undefined,
      supersedes: chainForTerm(allTerms, t.id).slice(0, -1).map((s) => ({
        id: s.id, amountEur: s.amount_eur, text: s.text, formality: s.formality, recordedAt: s.recorded_at,
      })),
    })),
    referencedInteractions: interactions
      .filter((i) => referencedInteractionIds.has(i.id))
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
      .map((i) => ({
        id: i.id, occurredAt: i.occurred_at, channel: i.channel, direction: i.direction,
        personName: i.person_id ? personById.get(i.person_id)?.full_name : undefined,
        excerpt: i.content.slice(0, 280),
      })),
  };
}

// Short, deterministic summary — no AI (§F is explicit: "IA no memo" is out
// of scope). One line per current term, plainest possible English.
export function buildDealMemoSummary(payload: DealMemoPayload): string {
  const lines = [
    `Deal memo — ${payload.entityName}`,
    `Archived ${payload.generatedAt.slice(0, 10)} · ${payload.terms.length} term${payload.terms.length === 1 ? '' : 's'} agreed`,
    '',
  ];
  for (const t of payload.terms) {
    const who = t.side === 'ours' ? 'We' : payload.entityName;
    const value = t.amountEur != null ? fmtEurPlain(t.amountEur) : t.text ?? '—';
    const edited = t.supersedes.length > 0 ? ` (revised ${t.supersedes.length}×)` : '';
    lines.push(`- ${who} — ${t.kind.replace('_', ' ')}: ${value}${edited}`);
  }
  if (payload.referencedInteractions.length > 0) {
    lines.push('', 'Referenced conversations:');
    for (const i of payload.referencedInteractions) {
      lines.push(`- ${i.occurredAt.slice(0, 10)} · ${i.channel.replace('_', ' ')}${i.personName ? ` · ${i.personName}` : ''} — "${i.excerpt}"`);
    }
  }
  return lines.join('\n');
}

function fmtEurPlain(n: number): string {
  return `€${Math.round(n).toLocaleString('en-US')}`;
}

// ---------------------------------------------------------------------------
// §D — a plain, deterministic (non-AI) label for "what's already on the
// table" for this entity, shown next to the composer as a founder-only UI
// hint. Deliberately NEVER passed into ComposerContext/buildComposerContext
// (src/lib/composer.ts) or any /api/compose request body — see
// TermsOnTheTable.tsx's own header comment and the delivery report's
// founder-privacy audit for why: that context feeds a model whose literal
// output is the outbound message text sent to (and read by) the investor,
// a single-audience artifact, so any deal_terms-derived signal reaching
// that prompt — even a topic label with no amount — would be the exact
// class of leak the CLAUDE.md founder-privacy root rule prohibits. This
// function's output is for React to render directly, never for a prompt.
export function topicsAlreadyOnTheTable(terms: DealTerm[], entityId: string): DealTerm['kind'][] {
  const current = currentTermsForEntity(terms, entityId).filter((t) => t.kind !== 'ask');
  return [...new Set(current.map((t) => t.kind))];
}
