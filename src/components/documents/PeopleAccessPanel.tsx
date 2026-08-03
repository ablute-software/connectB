'use client';
// P78 Bloco 1 — "People & Access", the transposed view of the data room:
// entity → person → document matrix, read-only ("o objetivo é pôr toda a
// gente a ver a mesma realidade antes de lhe mexer" — no edits here, that's
// Bloco 2+). Reuses the exact grant/person resolution the Grant Access flow
// in documents/page.tsx already established (person_affiliations, current
// only, entity_id fallback) — not a second mechanism.
//
// Revised 2026-07-31 per Nuno's own review of the first pass (adenda ao
// Prompt 78): that pass filtered the left column down to entities that
// already had a grant, which is backwards — this is meant to be a working
// view of the WHOLE pipeline (any entity in contact), where "no access
// yet" is itself a normal, visible state, not an exclusion filter. Also
// added: document descriptions, the private-document 4th effect state, and
// the granted/expires dates per cell (spec §9 — these existed on the
// access_grants row the whole time, just never surfaced here).
import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { computeCellEffect, findEffectiveGrant, type CellEffect } from '@/lib/people-access-matrix';
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
  no_effect_private: 'bg-gray-50 text-gray-300 italic',
};
// Deliberately English (this workspace's UI language), but the 4 states are
// exactly the spec's own 4 ("Vê" / "Vê após NDA" / "Não vê" / "Sem efeito —
// documento privado") — same meanings, not a 5th invented state.
const EFFECT_LABEL: Record<CellEffect, string> = {
  shared: '✓ Can view', shared_pending_nda: 'Can view after NDA', shared_pending_confirmation: 'Awaiting confirmation',
  not_shared: "Can't view", no_effect_private: 'No effect — private document',
};

function fmtDate(iso?: string) {
  return iso ? new Date(iso).toLocaleDateString() : undefined;
}

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

  // The whole pipeline, not just entities that already have a grant — per
  // Nuno's review, "no access yet" belongs IN this list, visibly, not
  // filtered out of it. Grant count (0 for most) makes that state honest.
  //
  // Post-Lote-1 adjustment: `db.entities` is already org-scoped (`.eq(
  // 'org_id', orgId)` in store-supabase.tsx) — it's the org's own pipeline,
  // never "everything". The real problem ablute_ surfaced is scale, not
  // scope: 600+ entities makes an always-rendered flat list unusable.
  // Search is the primary path per the spec's own intent — collapse to
  // "has access" by default, and only searching reveals the rest.
  const hasAccess = (entityId: string) => peopleForEntity(entityId).some((p) => grantedPersonIds.has(p.id));
  const query_ = query.trim().toLowerCase();
  const allEntities = useMemo(() => {
    return db.entities
      .filter((e) => (query_ ? e.name.toLowerCase().includes(query_) : hasAccess(e.id)))
      .sort((a, b) => {
        const aHas = hasAccess(a.id), bHas = hasAccess(b.id);
        if (aHas !== bHas) return aHas ? -1 : 1; // entities with access float to the top
        return a.name.localeCompare(b.name);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.entities, db.personAffiliations, db.people, grantedPersonIds, query_]);

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

  function DateHint({ grant }: { grant: ReturnType<typeof findEffectiveGrant> }) {
    if (!grant) return null;
    const granted = fmtDate(grant.granted_at);
    const expires = fmtDate(grant.expires_at ?? undefined);
    if (!granted && !expires) return null;
    return (
      <span className="ml-1.5 text-[9px] font-normal text-gray-400">
        {granted && `granted ${granted}`}{granted && expires && ' · '}{expires && `expires ${expires}`}
      </span>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div data-tour-id="people-entities">
      <Card title="Entities">
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

        {!query_ && <p className="mb-1.5 text-[11px] text-gray-400">Showing entities with access. Search to find any other entity in your pipeline.</p>}
        <ul className="space-y-0.5">
          {allEntities.map((e) => {
            const grantCount = peopleForEntity(e.id).filter((p) => grantedPersonIds.has(p.id)).length;
            return (
              <li key={e.id}>
                <button onClick={() => setSelectedEntityId(e.id)}
                  className={`block w-full rounded px-2 py-1.5 text-left text-sm ${selectedEntityId === e.id ? 'bg-[#E8F4F8] font-medium text-[#0E7490]' : 'text-gray-700 hover:bg-gray-50'}`}>
                  {e.name}
                  <span className={`ml-1.5 text-xs ${grantCount > 0 ? 'text-[#0E7490]' : 'text-gray-300'}`}>
                    {grantCount > 0 ? `(${grantCount} with access)` : '(no access yet)'}
                  </span>
                </button>
              </li>
            );
          })}
          {allEntities.length === 0 && query_ && <p className="text-xs text-gray-400">No entity matches “{query}”.</p>}
          {allEntities.length === 0 && !query_ && <p className="text-xs text-gray-400">No entity has any access yet — search to pick one from your pipeline.</p>}
        </ul>
      </Card>
      </div>

      <div className="md:col-span-2" data-tour-id="people-matrix">
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
                        const folderGrant = findEffectiveGrant(db.grants, undefined, f.id, selectedPersonIds);
                        const folderEffect = computeCellEffect(folderGrant, now);
                        return (
                          <div key={f.id} className="rounded-lg border border-gray-100 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-gray-800">▣ {f.name}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${EFFECT_STYLE[folderEffect]}`}>
                                {EFFECT_LABEL[folderEffect]}<DateHint grant={folderGrant} />
                              </span>
                            </div>
                            {docs.length > 0 && (
                              <ul className="mt-1.5 space-y-1 border-t border-gray-50 pt-1.5">
                                {docs.map((d) => {
                                  const docGrant = findEffectiveGrant(db.grants, d.id, f.id, selectedPersonIds);
                                  const effect = computeCellEffect(docGrant, now, d.visibility);
                                  return (
                                    <li key={d.id} className="flex items-start justify-between gap-2 pl-4 text-xs">
                                      <span className="text-gray-600">
                                        {d.name}
                                        {d.details && <span className="block text-[10px] text-gray-400">{d.details}</span>}
                                      </span>
                                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-right text-[10px] font-semibold ${EFFECT_STYLE[effect]}`}>
                                        {EFFECT_LABEL[effect]}<DateHint grant={docGrant} />
                                      </span>
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
