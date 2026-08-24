// Investor Workspace Fase 2 (prompt 55) — the 6 fixed diligence-journey
// sections, in order. Shared between the portal API route (grouping) and
// the client (section labels) so the two never drift.
export const PORTAL_SECTIONS = [
  { key: 'start_here', label: 'Start here' },
  { key: 'product_market', label: 'Product & market' },
  { key: 'traction_commercial', label: 'Traction & commercial' },
  { key: 'financial', label: 'Financial' },
  { key: 'team_governance', label: 'Team & governance' },
  { key: 'round_terms', label: 'Round terms' },
] as const;

export type PortalSectionKey = typeof PORTAL_SECTIONS[number]['key'];

// Prompt 350 §A — the other half of the Prompt 204 §A bug: 204 fixed which
// FOLDERS' documents are fetched (the descendant closure of granted
// folders), but the section MAP was still built from only the directly
// granted folders (portal_section is usually null on a root grant) —
// `sectionByFolderId.get(doc.folder_id)` failed for every doc living in a
// subfolder, so every section showed "In preparation" even with the
// investor fully authorized and the documents already in the payload.
//
// Fix: build the section map from ALL of the org's folders (portal_section
// lives on the folder regardless of whether THAT folder itself was granted
// — a grant is an authorization concept, portal_section is a taxonomy
// concept, and conflating them is exactly what caused this). Robustness,
// same discipline as data-room.ts's nearestFolderGrant: if a document's
// direct folder has no portal_section, climb parent_id until one is found;
// with none at all, the document lands in a trailing "Other documents"
// section rather than disappearing — an authorized-but-invisible document
// is the bug this prompt exists to kill, and silently dropping it into no
// section at all would just be a quieter version of the same bug.
export interface SectionFolder { id: string; parent_id?: string | null; portal_section: string | null }
export interface SectionedDocuments<D> { key: string; label: string; documents: D[] }

export const OTHER_DOCUMENTS_SECTION = { key: 'other', label: 'Other documents' } as const;

function resolveSectionForFolder(folderId: unknown, sectionByFolderId: Map<string, string | null>, parentOf: Map<string, string | null | undefined>): string | null {
  let cur = folderId as string | null | undefined;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const section = sectionByFolderId.get(cur);
    if (section) return section;
    cur = parentOf.get(cur);
  }
  return null;
}

export function groupDocumentsBySection<D extends { folder_id: unknown }>(
  folders: SectionFolder[], documents: D[],
): SectionedDocuments<D>[] {
  const sectionByFolderId = new Map(folders.map((f) => [f.id, f.portal_section]));
  const parentOf = new Map(folders.map((f) => [f.id, f.parent_id ?? null]));

  const sections: SectionedDocuments<D>[] = PORTAL_SECTIONS.map((s) => ({ key: s.key, label: s.label, documents: [] }));
  const sectionByKey = new Map(sections.map((s) => [s.key, s]));
  const other: D[] = [];

  for (const doc of documents) {
    const resolved = resolveSectionForFolder(doc.folder_id, sectionByFolderId, parentOf);
    const bucket = resolved ? sectionByKey.get(resolved) : undefined;
    if (bucket) bucket.documents.push(doc);
    else other.push(doc);
  }

  return other.length > 0 ? [...sections, { ...OTHER_DOCUMENTS_SECTION, documents: other }] : sections;
}
