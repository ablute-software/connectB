'use client';
// P78 Bloco 1 — "People & Access", the transposed view of the data room:
// entity → person → document matrix, read-only ("o objetivo é pôr toda a
// gente a ver a mesma realidade antes de lhe mexer" — no edits here, that's
// Bloco 2+). Reuses the exact grant/person resolution the Grant Access flow
// in documents/page.tsx already established (person_affiliations, current
// only, entity_id fallback) — not a second mechanism.
import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { computeCellEffect, type CellEffect } from '@/lib/people-access-matrix';
import type { Folder, PortalSection } from '@/lib/types';

const SECTION_LABELS: Record<PortalSection, string> = {
  start_here: 'Start here', product_market: 'Product & market', traction_commercial: 'Traction & commercial',
  financial: 'Financial', team_governance: 'Team & governance', round_terms: 'Round terms',
};
const SECTION_ORDER: (PortalSection | 'uncategorized')[] = [
  'start_here', 'product_market', 'traction_commercial', 'financial', 'team_governance', 'round_terms', 'uncategorized',
];

const EFFECT_STYLE: Record<CellEffect, string> = {
  shared: 'bg-green-100 text-green-800',
  shared_pending_nda: 'bg-amber-100 text-amber-800',
  shared_pending_confirmation: 'bg-amber-100 text-amber-800',
  not_shared: 'bg-gray-100 text-gray-400',
};
const EFFECT_LABEL: Record<CellEffect, string> = {
  shared: '✓ shared', shared_pending_nda: 'NDA pending', shared_pending_confirmation: 'awaiting confirmation', not_shared: 'not shared',
};

export function PeopleAccessPanel() {
  const { db } = useStore();
  const [query, setQuery] = useState('');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const now = new Date();

  function peopleForEntity(entityId: string) {
    const ids = new Set(db.personAffiliations.filter((a) => a.entity_id === entityId && a.current).map((a) => a.person_id));
    return db.people.filter((p) => ids.has(p.id) || p.entity_id === entityId);
  }

  const grantedPersonIds = useMemo(() => new Set(db.grants.filter((g) => g.person_id && !g.revoked_at).map((g) => g.person_id as string)), [db.grants]);

  // Prompt 78 Bloco 0 finding: the 2 real orphan grants have person_id=null
  // and only grantee_email — they can't be resolved into an entity/person
  // tree at all, which is exactly why this basket exists instead of forcing
  // a guess. Founder-driven association is a Bloco 2+ action, not built here.
  const orphanGrants = useMemo(() => db.grants.filter((g) => !g.person_id && !g.revoked_at), [db.grants]);

  const entitiesWithAccess = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.entities
      .filter((e) => peopleForEntity(e.id).some((p) => grantedPersonIds.has(p.id)))
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.entities, db.personAffiliations, db.people, grantedPersonIds, query]);

  const selectedEntity = db.entities.find((e) => e.id === selectedEntityId);
  const selectedPeople = selectedEntityId ? peopleForEntity(selectedEntityId) : [];
  const selectedPersonIds = new Set(selectedPeople.map((p) => p.id));

  const rootFolders = db.folders.filter((f) => !f.parent_id);
  const docsIn = (folderId: string) => db.documents.filter((d) => d.folder_id === folderId);

  const sections = useMemo(() => {
    const map = new Map<PortalSection | 'uncategorized', Folder[]>();
    for (const f of rootFolders) {
      const key = f.portal_section ?? 'uncategorized';
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.folders]);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card title="Entities with access">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search entity…"
          className="mb-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />

        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
          <div className="text-xs font-semibold text-amber-800">Por associar ({orphanGrants.length})</div>
          {orphanGrants.length === 0 ? (
            <p className="mt-1 text-[11px] text-amber-700">No unassociated grants.</p>
          ) : (
            <>
              <p className="mt-1 text-[11px] text-amber-700">
                Grants with no known person — created directly by email, never confirmed by anyone.
              </p>
              <ul className="mt-1.5 space-y-1">
                {orphanGrants.map((g) => (
                  <li key={g.id} className="text-xs text-amber-900">
                    {g.invited_name ?? g.grantee_email ?? g.invited_email ?? 'Unknown'}
                    {g.grantee_email && g.invited_name && <span className="text-amber-600"> · {g.grantee_email}</span>}
                    <span className="ml-1.5 text-amber-500">
                      → {g.document_id ? db.documents.find((d) => d.id === g.document_id)?.name : db.folders.find((f) => f.id === g.folder_id)?.name}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <ul className="space-y-0.5">
          {entitiesWithAccess.map((e) => (
            <li key={e.id}>
              <button onClick={() => setSelectedEntityId(e.id)}
                className={`block w-full rounded px-2 py-1.5 text-left text-sm ${selectedEntityId === e.id ? 'bg-[#E8F4F8] font-medium text-[#0E7490]' : 'text-gray-700 hover:bg-gray-50'}`}>
                {e.name}
                <span className="ml-1.5 text-xs text-gray-400">({peopleForEntity(e.id).filter((p) => grantedPersonIds.has(p.id)).length})</span>
              </button>
            </li>
          ))}
          {entitiesWithAccess.length === 0 && <p className="text-xs text-gray-400">No entity has any confirmed access yet.</p>}
        </ul>
      </Card>

      <div className="md:col-span-2">
        <Card title={selectedEntity ? `Access matrix — ${selectedEntity.name}` : 'Access matrix'}>
          {!selectedEntity ? (
            <p className="text-sm text-gray-400">Pick an entity on the left to see what it can see.</p>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-gray-400">
                {selectedPeople.length} known {selectedPeople.length === 1 ? 'person' : 'people'} at this entity:{' '}
                {selectedPeople.map((p) => p.full_name).join(', ') || '—'}
              </p>
              {SECTION_ORDER.map((key) => {
                const folders = sections.get(key) ?? [];
                if (folders.length === 0) return null;
                return (
                  <div key={key}>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {key === 'uncategorized' ? 'Uncategorized' : SECTION_LABELS[key]}
                    </div>
                    <div className="space-y-2">
                      {folders.map((f) => {
                        const docs = docsIn(f.id);
                        const folderEffect = computeCellEffect(db.grants, '__folder_row__', f.id, selectedPersonIds, now);
                        return (
                          <div key={f.id} className="rounded-lg border border-gray-100 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-gray-800">▣ {f.name}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${EFFECT_STYLE[folderEffect]}`}>{EFFECT_LABEL[folderEffect]}</span>
                            </div>
                            {docs.length > 0 && (
                              <ul className="mt-1.5 space-y-1 border-t border-gray-50 pt-1.5">
                                {docs.map((d) => {
                                  const effect = computeCellEffect(db.grants, d.id, f.id, selectedPersonIds, now);
                                  return (
                                    <li key={d.id} className="flex items-center justify-between gap-2 pl-4 text-xs">
                                      <span className="text-gray-600">{d.name}</span>
                                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${EFFECT_STYLE[effect]}`}>{EFFECT_LABEL[effect]}</span>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
