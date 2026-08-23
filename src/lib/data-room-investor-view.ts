// Prompt 338 — pure logic for the investor's "Data room" panel: which grant
// effectively covers a document (document-level overrides its folder's,
// same precedence resolveDocumentAccess already uses), whether that makes
// it locked (NDA required, not yet accepted — nda_accepted_at is set by the
// founder's own AI-cross-checked signed-NDA upload; there is no investor-
// side "I accept" click anywhere in this app, confirmed by reading), and
// whether it counts as "new since the investor's last visit" to this panel.
export interface DataRoomGrantLike {
  document_id?: string | null; folder_id?: string | null;
  nda_required: boolean; nda_accepted_at?: string | null;
  expires_at?: string | null; granted_at: string;
}
export interface DataRoomDocLike { id: string; folder_id: string | null }

export function effectiveGrantForDoc<T extends DataRoomGrantLike>(doc: DataRoomDocLike, grants: T[]): T | undefined {
  const byDoc = grants.find((g) => g.document_id === doc.id);
  if (byDoc) return byDoc;
  return grants.find((g) => g.folder_id === doc.folder_id);
}

export function isDocLocked(grant: DataRoomGrantLike | undefined): boolean {
  return !!grant?.nda_required && !grant?.nda_accepted_at;
}

// No baseline (never visited before) deliberately shows nothing as "new" —
// the whole panel is new to them on a first visit, so a wall of "new"
// badges would be noise, not signal.
export function isDocNew(grantedAt: string, lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  return new Date(grantedAt) > new Date(lastSeenAt);
}

export function groupByFolder<T extends { folderName: string }>(docs: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const d of docs) map.set(d.folderName, [...(map.get(d.folderName) ?? []), d]);
  return map;
}
