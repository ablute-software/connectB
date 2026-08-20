'use client';
// Prompt 278 §3 — "Who has access to this", scoped to whichever folder is
// currently selected in the Folders tree (documents/page.tsx's own
// selFolder) — deliberately NOT a second "Granted so far" (that panel
// lists grants by person, across the whole data room; this one answers
// "for THIS specific folder, who can actually see it, and how much of
// it"). Reuses findEffectiveGrant/computeCellEffect (people-access-
// matrix.ts) exactly as PeopleAccessPanel.tsx already does — same
// folder->document cascade precedence, not reimplemented a third time.
import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { findEffectiveGrant, computeCellEffect } from '@/lib/people-access-matrix';

interface AccessRow {
  entityId: string;
  entityName: string;
  kind: 'complete' | 'partial';
  partialDocNames: string[];
}

export function WhoHasAccessPanel({ folderId }: { folderId: string }) {
  const { db } = useStore();
  const folder = db.folders.find((f) => f.id === folderId);
  const folderTree = useMemo(() => db.folders.map((f) => ({ id: f.id, parent_id: f.parent_id })), [db.folders]);
  const docsInFolder = useMemo(() => db.documents.filter((d) => d.folder_id === folderId), [db.documents, folderId]);
  const now = new Date();

  const rows = useMemo(() => {
    if (!folderId) return [] as AccessRow[];
    const out: AccessRow[] = [];
    for (const e of db.entities) {
      const personIds = new Set([
        ...db.personAffiliations.filter((a) => a.entity_id === e.id && a.current).map((a) => a.person_id),
        ...db.people.filter((p) => p.entity_id === e.id).map((p) => p.id),
      ]);
      if (personIds.size === 0) continue;

      const folderGrant = findEffectiveGrant(db.grants, undefined, folderId, personIds, folderTree);
      const folderEffect = computeCellEffect(folderGrant, now);
      if (folderEffect !== 'not_shared') {
        out.push({ entityId: e.id, entityName: e.name, kind: 'complete', partialDocNames: [] });
        continue;
      }

      const partialDocs = docsInFolder.filter((d) => {
        const docGrant = findEffectiveGrant(db.grants, d.id, folderId, personIds, folderTree);
        const effect = computeCellEffect(docGrant, now, d.visibility);
        return effect !== 'not_shared' && effect !== 'no_effect_private';
      });
      if (partialDocs.length > 0) out.push({ entityId: e.id, entityName: e.name, kind: 'partial', partialDocNames: partialDocs.map((d) => d.name) });
    }
    return out.sort((a, b) => a.entityName.localeCompare(b.entityName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.entities, db.personAffiliations, db.people, db.grants, folderTree, docsInFolder, folderId]);

  if (!folder) return null;

  return (
    <Card title={`Who has access — ${folder.name}`}>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">No investor has access to this folder yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 text-sm">
          {rows.map((r) => (
            <li key={r.entityId} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="font-medium text-gray-800">{r.entityName}</span>
              {r.kind === 'complete' ? (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-800">Complete access to folder</span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800"
                  title={r.partialDocNames.join(', ')}>
                  Access to {r.partialDocNames.length} partial doc{r.partialDocNames.length === 1 ? '' : 's'} in this folder
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
