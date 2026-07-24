// Shared "apply a verified contribution to its subject" logic — the fix for
// the bug where a contribution marked 'verified' (via either the founder-
// facing ContributionBox Accept button or the back-office Fila review queue)
// never actually wrote its value onto the entity/person row. Both review
// paths flipped `contributions.status` and stopped there; the write-back
// either depended on a separate client-side call the back-office queue never
// made at all, or simply never happened. Confirmed live on "Banif Capital":
// 14 contributions marked status='verified', every one of the entity's
// structured fields still null.
//
// Fixed by moving the write server-side, into the SAME place status flips to
// 'verified', regardless of which UI triggered it. Reuses entity-enrichment's
// allowlist/coercion/non-clobbering pipeline (resolveEntityFieldWrite) so a
// promoted fact is held to the exact same guarantees as a freshly-proposed
// one: unknown field names are never written (freeform "+ Add info" notes
// like "co-investor" have no structured column and are correctly left as
// contributions-only), a field the subject already holds is never
// overwritten (whether that value came from a human or an earlier accepted
// fact), and a value that fails to coerce is dropped rather than guessed.
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveEntityFieldWrite } from './entity-enrichment';
import type { Entity } from './types';

// Mirrors /api/backoffice/research's PERSON_FIELDS — the only Person columns
// enrichment/contributions are ever allowed to write.
const PERSON_WRITABLE_FIELDS = ['linkedin_url', 'role', 'background', 'hook'] as const;
type PersonWritableField = typeof PERSON_WRITABLE_FIELDS[number];
function isPersonWritableField(field: string): field is PersonWritableField {
  return (PERSON_WRITABLE_FIELDS as readonly string[]).includes(field);
}
function personHasValue(person: Record<string, unknown>, field: PersonWritableField): boolean {
  const v = person[field];
  return v != null && v !== '';
}

export type PromotionReason = 'applied' | 'not_writable_field' | 'already_set' | 'subject_not_found' | 'coerce_failed';
export interface PromotionResult { applied: boolean; reason: PromotionReason }

export interface PromotableContribution {
  subject_type: 'entity' | 'person';
  subject_id: string;
  field: string;
  value: unknown;
}

// Applies one verified contribution's value onto its entity/person row, if
// (and only if) it safely can. Never throws on an unwritable/duplicate field
// — that's an expected, common outcome (most manual contributions have no
// matching column at all), not an error.
export async function applyVerifiedContribution(admin: SupabaseClient, c: PromotableContribution): Promise<PromotionResult> {
  if (c.subject_type === 'entity') {
    const { data: entity } = await admin.from('entities').select('*').eq('id', c.subject_id).maybeSingle();
    if (!entity) return { applied: false, reason: 'subject_not_found' };
    const resolved = resolveEntityFieldWrite(entity as Entity, c.field, c.value);
    if (!resolved) {
      const { isKnownEntityField, entityHasValue } = await import('./entity-enrichment');
      if (!isKnownEntityField(c.field)) return { applied: false, reason: 'not_writable_field' };
      if (entityHasValue(entity as Entity, c.field)) return { applied: false, reason: 'already_set' };
      return { applied: false, reason: 'coerce_failed' };
    }
    const { error } = await admin.from('entities').update({ [resolved.field]: resolved.value }).eq('id', c.subject_id);
    if (error) throw new Error(error.message);
    return { applied: true, reason: 'applied' };
  }

  if (!isPersonWritableField(c.field)) return { applied: false, reason: 'not_writable_field' };
  const { data: person } = await admin.from('people').select('*').eq('id', c.subject_id).maybeSingle();
  if (!person) return { applied: false, reason: 'subject_not_found' };
  if (personHasValue(person, c.field)) return { applied: false, reason: 'already_set' };
  const value = typeof c.value === 'string' ? c.value.trim() : c.value;
  if (!value) return { applied: false, reason: 'coerce_failed' };
  const { error } = await admin.from('people').update({ [c.field]: value }).eq('id', c.subject_id);
  if (error) throw new Error(error.message);
  return { applied: true, reason: 'applied' };
}

// Fields that already have a pending or previously-applied AI proposal for
// this subject — checked BEFORE inserting new enrichment proposals so a
// second "Request more info" click (e.g. before the first batch is reviewed)
// can't create duplicate rows for the same field. Complements
// prepareEnrichmentProposals's entityHasValue check, which only sees what's
// already landed on the entity row, not what's still sitting unreviewed.
export async function fieldsAlreadyProposed(admin: SupabaseClient, subjectType: 'entity' | 'person', subjectId: string): Promise<Set<string>> {
  const { data } = await admin.from('contributions').select('field')
    .eq('subject_type', subjectType).eq('subject_id', subjectId)
    .eq('source', 'ai').in('status', ['submitted', 'verified']);
  return new Set((data ?? []).map((r) => r.field as string));
}
