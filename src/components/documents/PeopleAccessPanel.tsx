'use client';
// P78 Bloco 1 — "People & Access", the transposed view of the data room:
// entity → person → document matrix. Reuses the exact grant/person
// resolution the Grant Access flow in documents/page.tsx already
// established (person_affiliations, current only, entity_id fallback) —
// not a second mechanism.
//
// Revised 2026-07-31 per Nuno's own review of the first pass (adenda ao
// Prompt 78): that pass filtered the left column down to entities that
// already had a grant, which is backwards — this is meant to be a working
// view of the WHOLE pipeline (any entity in contact), where "no access
// yet" is itself a normal, visible state, not an exclusion filter. Also
// added: document descriptions, the private-document 4th effect state, and
// the granted/expires dates per cell (spec §9 — these existed on the
// access_grants row the whole time, just never surfaced here).
//
// Prompt 145 (Bloco 2) — the matrix is now clickable. A `not_shared` cell
// opens the inline grant form below (NDA + optional expiry, same fields
// submitGrantTree() in documents/page.tsx already writes); a
// shared/shared_pending_* cell offers to revoke, confirm()-gated. Both
// reuse store.addGrant()/revokeGrant() directly — no new route, no
// access_grants schema/RLS change, per the prompt's own boundary.
// `no_effect_private` cells are deliberately left non-interactive: that
// effect fires because the document's own visibility is 'due_diligence'
// (checked in computeCellEffect() BEFORE any grant lookup, see
// people-access-matrix.ts), so a grant on it can never change what the
// cell shows — the prompt's literal wording ("clicar numa célula
// not_shared/no_effect_private chama addGrant()") would create a grant
// that's permanently inert. Flagged as a deviation, not silently applied.
import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { useConfirm } from '@/lib/confirm';
import { Card } from '@/components/ui';
import { computeCellEffect, findEffectiveGrant, type CellEffect } from '@/lib/people-access-matrix';
import type { Folder, PortalSection } from '@/lib/types';

type GrantTarget = { kind: 'folder' | 'doc'; id: string; name: string };

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
  const { db, addGrant, revokeGrant } = useStore();
  const confirm = useConfirm();
  // Prompt 204 §A — a arvore que findEffectiveGrant precisa para saber que um
  // grant numa pasta-mae cobre as subpastas.
  const folderTree = db.folders.map((f) => ({ id: f.id, parent_id: f.parent_id }));
  const [query, setQuery] = useState('');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [grantTarget, setGrantTarget] = useState<GrantTarget | null>(null);
  const [grantNda, setGrantNda] = useState(false);
  const [grantExpiry, setGrantExpiry] = useState('');
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

  function openGrantForm(target: GrantTarget) {
    setGrantTarget(target);
    setGrantNda(false);
    setGrantExpiry('');
  }

  function confirmGrant() {
    if (!grantTarget || selectedPersonIds.size === 0) return;
    const expires_at = grantExpiry ? `${grantExpiry}T23:59:59Z` : undefined;
    for (const personId of selectedPersonIds) {
      addGrant({
        person_id: personId,
        document_id: grantTarget.kind === 'doc' ? grantTarget.id : undefined,
        folder_id: grantTarget.kind === 'folder' ? grantTarget.id : undefined,
        expires_at, nda_required: grantNda,
      });
    }
    setGrantTarget(null);
  }

  async function revokeForItem(kind: 'folder' | 'doc', id: string, name: string) {
    const active = db.grants.filter((g) =>
      g.person_id && selectedPersonIds.has(g.person_id) && !g.revoked_at
      && (kind === 'doc' ? g.document_id === id : g.folder_id === id && !g.document_id));
    if (!active.length) return;
    const ok = await confirm({
      message: `Revoke access to "${name}" for ${active.length} ${active.length === 1 ? 'person' : 'people'} at ${selectedEntity?.name ?? 'this entity'}?`,
      destructive: true,
    });
    if (!ok) return;
    active.forEach((g) => revokeGrant(g.id));
  }

  function cellProps(effect: CellEffect, kind: 'folder' | 'doc', id: string, name: string) {
    if (effect === 'no_effect_private') return { as: 'span' as const };
    if (effect === 'not_shared') {
      const disabled = selectedPersonIds.size === 0;
      return {
        as: 'button' as const,
        disabled,
        title: disabled ? 'No known people at this entity yet' : `Grant "${name}" to ${selectedPersonIds.size} ${selectedPersonIds.size === 1 ? 'person' : 'people'}`,
        onClick: () => openGrantForm({ kind, id, name }),
      };
    }
    return { as: 'button' as const, title: `Revoke access to "${name}"`, onClick: () => revokeForItem(kind, id, name) };
  }

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

              {grantTarget && (
                <div className="rounded-lg border border-[#0E7490] bg-cyan-50 p-3">
                  <p className="text-xs font-medium text-[#0E7490]">
                    Grant &quot;{grantTarget.name}&quot; to {selectedPersonIds.size} {selectedPersonIds.size === 1 ? 'person' : 'people'} at {selectedEntity.name}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600">
                      <input type="checkbox" checked={grantNda} onChange={(e) => setGrantNda(e.target.checked)} />
                      Requires NDA
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-gray-600">
                      Expires
                      <input type="date" value={grantExpiry} onChange={(e) => setGrantExpiry(e.target.value)} className="rounded border border-gray-300 px-1.5 py-0.5 text-xs" />
                    </label>
                    <button onClick={confirmGrant} className="rounded-lg bg-[#0E7490] px-3 py-1 text-xs font-medium text-white">Grant access</button>
                    <button onClick={() => setGrantTarget(null)} className="text-xs text-gray-400 hover:underline">Cancel</button>
                  </div>
                </div>
              )}

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
                        const folderGrant = findEffectiveGrant(db.grants, undefined, f.id, selectedPersonIds, folderTree);
                        const folderEffect = computeCellEffect(folderGrant, now);
                        return (
                          <div key={f.id} className="rounded-lg border border-gray-100 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-gray-800">▣ {f.name}</span>
                              {(() => {
                                const cp = cellProps(folderEffect, 'folder', f.id, f.name);
                                const cls = `rounded px-1.5 py-0.5 text-[10px] font-semibold ${EFFECT_STYLE[folderEffect]} ${cp.as === 'button' && !cp.disabled ? 'cursor-pointer hover:ring-1 hover:ring-[#0E7490]' : ''} ${cp.disabled ? 'cursor-not-allowed' : ''}`;
                                return cp.as === 'button' ? (
                                  <button type="button" disabled={cp.disabled} title={cp.title} onClick={cp.onClick} className={cls}>
                                    {EFFECT_LABEL[folderEffect]}<DateHint grant={folderGrant} />
                                  </button>
                                ) : (
                                  <span className={cls}>{EFFECT_LABEL[folderEffect]}<DateHint grant={folderGrant} /></span>
                                );
                              })()}
                            </div>
                            {docs.length > 0 && (
                              <ul className="mt-1.5 space-y-1 border-t border-gray-50 pt-1.5">
                                {docs.map((d) => {
                                  const docGrant = findEffectiveGrant(db.grants, d.id, f.id, selectedPersonIds, folderTree);
                                  const effect = computeCellEffect(docGrant, now, d.visibility);
                                  return (
                                    <li key={d.id} className="flex items-start justify-between gap-2 pl-4 text-xs">
                                      <span className="text-gray-600">
                                        {d.name}
                                        {d.details && <span className="block text-[10px] text-gray-400">{d.details}</span>}
                                      </span>
                                      {(() => {
                                        const cp = cellProps(effect, 'doc', d.id, d.name);
                                        const cls = `shrink-0 rounded px-1.5 py-0.5 text-right text-[10px] font-semibold ${EFFECT_STYLE[effect]} ${cp.as === 'button' && !cp.disabled ? 'cursor-pointer hover:ring-1 hover:ring-[#0E7490]' : ''} ${cp.disabled ? 'cursor-not-allowed' : ''}`;
                                        return cp.as === 'button' ? (
                                          <button type="button" disabled={cp.disabled} title={cp.title} onClick={cp.onClick} className={cls}>
                                            {EFFECT_LABEL[effect]}<DateHint grant={docGrant} />
                                          </button>
                                        ) : (
                                          <span className={cls}>{EFFECT_LABEL[effect]}<DateHint grant={docGrant} /></span>
                                        );
                                      })()}
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
