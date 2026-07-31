// P78 Bloco 1 — pure helper for the People & Access matrix. Shows the
// EFFECT of a grant, never the raw intent: a folder-level grant on a
// document that also carries a more specific document-level grant must
// resolve to the document-level one (same precedence resolveDocumentAccess
// already uses in data-room.ts — kept as a separate, smaller function here
// because the matrix also needs the intermediate "pending" states that
// resolveDocumentAccess collapses into a single pendingCount).
import { grantStatus, type GrantStatusInput } from './access-grants';

export type CellEffect = 'shared' | 'shared_pending_nda' | 'shared_pending_confirmation' | 'not_shared';

export interface MatrixGrant extends GrantStatusInput {
  person_id?: string;
  document_id?: string;
  folder_id?: string;
  nda_required: boolean;
  nda_accepted_at?: string;
}

export function computeCellEffect(
  grants: MatrixGrant[], documentId: string, folderId: string | undefined, personIds: Set<string>, now: Date,
): CellEffect {
  const relevant = grants.filter((g) => g.person_id && personIds.has(g.person_id));
  const docGrant = relevant.find((g) => g.document_id === documentId);
  const folderGrant = folderId ? relevant.find((g) => g.folder_id === folderId && !g.document_id) : undefined;
  const effective = docGrant ?? folderGrant;
  if (!effective) return 'not_shared';
  const status = grantStatus(effective, now);
  if (status === 'revoked' || status === 'expired') return 'not_shared';
  if (status === 'pending_confirmation') return 'shared_pending_confirmation';
  if (effective.nda_required && !effective.nda_accepted_at) return 'shared_pending_nda';
  return 'shared';
}
