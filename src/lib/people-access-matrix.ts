// P78 Bloco 1 (revised per Nuno's Bloco 1 review, 2026-07-31 addenda) — pure
// helper for the People & Access matrix. Shows the EFFECT of a grant, never
// the raw intent: a folder-level grant on a document that also carries a
// more specific document-level grant must resolve to the document-level
// one (same precedence resolveDocumentAccess already uses in data-room.ts
// — kept as a separate, smaller function here because the matrix also
// needs the intermediate "pending" states resolveDocumentAccess collapses
// into a single pendingCount, AND the actual grant object for its dates,
// which resolveDocumentAccess never returns).
import { grantStatus, type GrantStatusInput } from './access-grants';

export type CellEffect = 'shared' | 'shared_pending_nda' | 'shared_pending_confirmation' | 'not_shared' | 'no_effect_private';

export interface MatrixGrant extends GrantStatusInput {
  person_id?: string;
  document_id?: string;
  folder_id?: string;
  nda_required: boolean;
  nda_accepted_at?: string;
  granted_at?: string;
}

// The grant that actually decides this cell, before turning it into an
// effect — exposed separately so the UI can show its dates (granted_at,
// expires_at) even when the effect itself is a simple badge.
export function findEffectiveGrant(
  grants: MatrixGrant[], documentId: string | undefined, folderId: string | undefined, personIds: Set<string>,
): MatrixGrant | undefined {
  const relevant = grants.filter((g) => g.person_id && personIds.has(g.person_id));
  const docGrant = documentId ? relevant.find((g) => g.document_id === documentId) : undefined;
  const folderGrant = folderId ? relevant.find((g) => g.folder_id === folderId && !g.document_id) : undefined;
  return docGrant ?? folderGrant;
}

// documentVisibility is only meaningful for a document-level cell (folders
// don't carry their own visibility) — 'private' means no grant can ever
// have an effect here, spec's own explicit 4th state ("Sem efeito —
// documento privado"), which used to fail silently (indistinguishable from
// "not shared") before this addenda asked for it by name.
export function computeCellEffect(effectiveGrant: MatrixGrant | undefined, now: Date, documentVisibility?: string): CellEffect {
  if (documentVisibility === 'private') return 'no_effect_private';
  if (!effectiveGrant) return 'not_shared';
  const status = grantStatus(effectiveGrant, now);
  if (status === 'revoked' || status === 'expired') return 'not_shared';
  if (status === 'pending_confirmation') return 'shared_pending_confirmation';
  if (effectiveGrant.nda_required && !effectiveGrant.nda_accepted_at) return 'shared_pending_nda';
  return 'shared';
}
