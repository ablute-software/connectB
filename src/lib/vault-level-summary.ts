// Prompt 741 §A.5 — the Vault's "what's restricted, at a glance" arithmetic,
// pulled out as pure functions so it's pinned by unit tests instead of only
// by a live click-through. Reused for both the top-of-tab pastilles (org-
// wide) and the per-folder dots in the tree (folder + every descendant).
import type { DocVisibility } from './types';
import { descendantFolderIds, type TreeDocument, type TreeFolder } from './data-room';

export type VisibilityCounts = Record<DocVisibility, number>;

const EMPTY_COUNTS: VisibilityCounts = { open: 0, on_grant: 0, due_diligence: 0 };

// Prompt 742 §B.3 — moved out of documents/page.tsx (where it was the only
// copy) so the investor-side dossier mirror (StartupDossierContent.tsx)
// reads the exact same icons/colors instead of a second, driftable copy.
// Investor-side labels can be variants ("Open to you" instead of "Open" —
// built locally where they're used), but the icon/color/title vocabulary
// itself is one source, per the prompt's own instruction.
export const VISIBILITY_META: Record<DocVisibility, { icon: string; label: string; title: string }> = {
  due_diligence: { icon: '🔴🔒', label: 'Due diligence only', title: 'Due diligence only — fully closed, requires an access request' },
  on_grant: { icon: '🟡🔓', label: 'On request', title: 'On request — simple access grant needed' },
  open: { icon: '🟢🔓✕', label: 'Open', title: 'Openly shareable — still only reaches whoever you grant access to' },
};
export const VISIBILITY_OPTIONS: DocVisibility[] = ['open', 'on_grant', 'due_diligence'];
// Prompt 741 — the same three colors, everywhere a level shows as a pill.
export const VISIBILITY_PILL_CLASS: Record<DocVisibility, string> = {
  open: 'bg-green-100 text-green-800',
  on_grant: 'bg-amber-100 text-amber-800',
  due_diligence: 'bg-red-100 text-[#B00000]',
};

export function countByVisibility(docs: { visibility: DocVisibility }[]): VisibilityCounts {
  const counts: VisibilityCounts = { ...EMPTY_COUNTS };
  for (const d of docs) counts[d.visibility] += 1;
  return counts;
}

// §A.2 — a folder "contains" restricted material if any level below it does
// — the closure of a folder and every descendant, via descendantFolderIds
// (the same function resolveDocumentAccess already relies on for the
// opposite direction), not a second tree walk of this module's own. A
// document with no folder_id at all (org root) is never counted under any
// folder — it only ever shows in the org-wide pastilles.
//
// Computed ONCE for every folder in one call (§A.5's own "once per render,
// not per node"): the page calls this once, builds a Map, and hands each
// FolderNode a plain `(id) => map.get(id)` lookup — nothing here is called
// again while the tree renders.
export function levelCountsByFolder(
  folders: TreeFolder[],
  docs: (TreeDocument & { visibility: DocVisibility })[],
): Map<string, VisibilityCounts> {
  const result = new Map<string, VisibilityCounts>();
  for (const f of folders) {
    const scope = new Set(descendantFolderIds(folders, [f.id]));
    const scoped = docs.filter((d) => d.folder_id != null && scope.has(d.folder_id));
    result.set(f.id, countByVisibility(scoped));
  }
  return result;
}

// §A.1 — only the levels with N>0 are ever shown (a 🟢0 pill is noise, not
// information); this is the one place that decision is made, so the org
// pastilles and the per-folder dots can't render the rule differently.
export function nonZeroLevels(counts: VisibilityCounts): { visibility: DocVisibility; count: number }[] {
  return (Object.entries(counts) as [DocVisibility, number][])
    .filter(([, count]) => count > 0)
    .map(([visibility, count]) => ({ visibility, count }));
}

// §A.1 — clicking a pastille filters; clicking the same one again clears.
// null means "no filter" throughout this module and its callers.
export function toggleVisibilityFilter(current: DocVisibility | null, clicked: DocVisibility): DocVisibility | null {
  return current === clicked ? null : clicked;
}

export function filterByVisibility<T extends { visibility: DocVisibility }>(docs: T[], filter: DocVisibility | null): T[] {
  return filter === null ? docs : docs.filter((d) => d.visibility === filter);
}
