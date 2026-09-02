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
import type { TreeFolder } from './data-room';

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
// Prompt 204 §A — a mesma extensao que resolveDocumentAccess levou: um grant
// de pasta cobre a subarvore, e o ancestral MAIS PROXIMO ganha. Sem isto a
// matriz do founder dizia "not shared" para tudo o que estivesse numa
// subpasta de uma pasta concedida — que e literalmente a queixa do §B ("o
// founder nao ve o que foi concedido"), com a mesma raiz do §A.
//
// `folders` fica obrigatorio pela mesma razao: e uma regra de acesso, e um
// chamador que se esqueca reintroduz o bug em silencio.
export function findEffectiveGrant(
  grants: MatrixGrant[], documentId: string | undefined, folderId: string | undefined,
  personIds: Set<string>, folders: TreeFolder[],
): MatrixGrant | undefined {
  return findEffectiveGrantAmong(grants.filter((g) => g.person_id && personIds.has(g.person_id)), documentId, folderId, folders);
}

// Prompt 530 — the same precedence, over an ALREADY-SCOPED set of grants.
// findEffectiveGrant scopes by person_id, which silently returns "nothing
// granted" for a data-room relationship that has no person at all (a grant
// created straight to an email address: person_id is null, only
// invited_email/grantee_email identify the recipient). That is exactly the
// `Por associar` case, so the People & Access matrix for a guest recipient
// was always empty. The caller now decides what belongs to the
// relationship — by person OR by email — and this function only decides
// specificity: document > nearest folder ancestor > ... > root.
export function findEffectiveGrantAmong(
  relevant: MatrixGrant[], documentId: string | undefined, folderId: string | undefined, folders: TreeFolder[],
): MatrixGrant | undefined {
  const docGrant = documentId ? relevant.find((g) => g.document_id === documentId) : undefined;
  if (docGrant) return docGrant;

  const parentOf = new Map(folders.map((f) => [f.id, f.parent_id]));
  const seen = new Set<string>();
  let cur = folderId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const g = relevant.find((x) => x.folder_id === cur && !x.document_id);
    if (g) return g;
    cur = parentOf.get(cur);
  }
  return undefined;
}

// documentVisibility is only meaningful for a document-level cell (folders
// don't carry their own visibility) — 'due_diligence' (was 'private',
// migration 0100) means no grant can ever have an effect here, spec's own
// explicit 4th state ("Sem efeito — documento privado"), which used to fail
// silently (indistinguishable from "not shared") before this addenda asked
// for it by name.
export function computeCellEffect(effectiveGrant: MatrixGrant | undefined, now: Date, documentVisibility?: string): CellEffect {
  if (documentVisibility === 'due_diligence') return 'no_effect_private';
  if (!effectiveGrant) return 'not_shared';
  const status = grantStatus(effectiveGrant, now);
  if (status === 'revoked' || status === 'expired') return 'not_shared';
  if (status === 'pending_confirmation') return 'shared_pending_confirmation';
  if (effectiveGrant.nda_required && !effectiveGrant.nda_accepted_at) return 'shared_pending_nda';
  return 'shared';
}
