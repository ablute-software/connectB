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
//
// Prompt 530 — the duplicated-entity bug, and what it forced.
//
// The left column used to render `db.grants.filter((g) => !g.person_id &&
// !g.revoked_at)` one <li> per row. Sixty documents shared with one email
// is sixty access_grants rows, so that one investor appeared sixty times,
// all amber, all "Por associar". The list was showing GRANTS while calling
// itself Entities. It is now built by buildAccessRelationships()
// (lib/data-room-access-relationships.ts) — one row per relationship,
// grouped by entity where one is known and by email where it is not, with
// the email resolved into a known person's entity when one carries it (the
// guest → registered investor continuity requirement: identity resolution,
// never a second row). Grants stayed exactly as they are; only the reading
// of them changed.
//
// The right column follows from that: a relationship can be email-only, so
// the matrix scopes by the relationship's own grants (findEffectiveGrantAmong)
// rather than by person_id alone — which is why a `Por associar` recipient
// used to select into a completely empty Access Matrix. It also now folds
// folders open/closed, keeps expired grants visible with their own tag
// (they must be inspectable and extendable, not hidden), and manages access
// in place: revoke one document, extend/reactivate validity, or add more
// documents to the same relationship — always through the store's own
// addGrant/revokeGrant/extendGrant, which write through the founder's
// RLS-scoped client, so the org boundary is enforced by Postgres, not here.
import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { useConfirm } from '@/lib/confirm';
import { Card } from '@/components/ui';
import { computeCellEffect, findEffectiveGrantAmong, type CellEffect, type MatrixGrant } from '@/lib/people-access-matrix';
import { grantStatus } from '@/lib/access-grants';
import {
  buildAccessRelationships, matchesRelationshipQuery,
  type AccessRelationship, type RelationshipGrant,
} from '@/lib/data-room-access-relationships';
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

function fmtDate(iso?: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : undefined;
}

/** yyyy-mm-dd today+days, for the date input's default when extending. */
function isoDateIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function PeopleAccessPanel() {
  const { db, addGrant, revokeGrant, extendGrant } = useStore();
  const confirm = useConfirm();
  // Prompt 204 §A — a arvore que findEffectiveGrant precisa para saber que um
  // grant numa pasta-mae cobre as subpastas.
  const folderTree = useMemo(() => db.folders.map((f) => ({ id: f.id, parent_id: f.parent_id })), [db.folders]);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [grantTargets, setGrantTargets] = useState<GrantTarget[]>([]);
  const [grantNda, setGrantNda] = useState(false);
  const [grantExpiry, setGrantExpiry] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [extendingGrantId, setExtendingGrantId] = useState<string | null>(null);
  const [extendDate, setExtendDate] = useState('');
  const [notice, setNotice] = useState('');
  const now = new Date();

  function peopleForEntity(entityId: string) {
    const ids = new Set(db.personAffiliations.filter((a) => a.entity_id === entityId && a.current).map((a) => a.person_id));
    return db.people.filter((p) => ids.has(p.id) || p.entity_id === entityId);
  }

  // One row per relationship — the whole point of Prompt 530. Recomputes
  // from db.grants, so every access change below (add / revoke / extend)
  // re-derives both columns in the same render; nothing here caches a count.
  const relationships = useMemo(() => buildAccessRelationships({
    entities: db.entities.map((e) => ({ id: e.id, name: e.name })),
    people: db.people.map((p) => ({ id: p.id, entity_id: p.entity_id, full_name: p.full_name, email_verified: p.email_verified, email_guess: p.email_guess })),
    affiliations: db.personAffiliations.map((a) => ({ person_id: a.person_id, entity_id: a.entity_id, current: a.current })),
    grants: db.grants as RelationshipGrant[],
    folders: folderTree,
    documents: db.documents.map((d) => ({ id: d.id, folder_id: d.folder_id, visibility: d.visibility })),
    now,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [db.entities, db.people, db.personAffiliations, db.grants, db.documents, folderTree]);

  const query_ = query.trim().toLowerCase();

  // Entities in the pipeline that have no access relationship at all. Kept
  // out of the default list (600+ entities makes a flat always-on list
  // unusable — the post-Lote-1 reason search is the primary path here) but
  // reachable the moment the founder types, because "no access yet" is
  // itself an answer worth seeing.
  const pipelineOnlyRows = useMemo(() => {
    if (!query_) return [];
    const covered = new Set(relationships.map((r) => r.entityId).filter(Boolean) as string[]);
    return db.entities
      .filter((e) => !covered.has(e.id) && e.name.toLowerCase().includes(query_))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 50)
      .map((e) => ({ id: e.id, name: e.name }));
  }, [db.entities, relationships, query_]);

  // Filtering happens on every keystroke — no Enter, no Search button.
  const visibleRelationships = useMemo(
    () => relationships.filter((r) => matchesRelationshipQuery(r, query_)),
    [relationships, query_],
  );

  const selected = relationships.find((r) => r.key === selectedKey) ?? null;
  const selectedPipelineEntity = !selected && selectedKey?.startsWith('entity:')
    ? db.entities.find((e) => `entity:${e.id}` === selectedKey) ?? null
    : null;

  // Who a NEW grant in this relationship goes to. For an existing
  // relationship that is the recipients it already has — adding documents
  // must not quietly widen access to colleagues who never had any. Only an
  // entity with no access yet falls back to its known people, which is the
  // ordinary "first grant to this investor" case.
  const grantPersonIds = useMemo(() => {
    if (selected) return selected.personIds;
    if (selectedPipelineEntity) return peopleForEntity(selectedPipelineEntity.id).map((p) => p.id);
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedPipelineEntity, db.people, db.personAffiliations]);
  const grantGuestEmails = selected?.guestEmails ?? [];
  const canGrant = grantPersonIds.length > 0 || grantGuestEmails.length > 0;

  const selectedName = selected?.name ?? selectedPipelineEntity?.name ?? '';

  // The relationship's own grants, split the way access itself is: live
  // grants decide what the recipient can open right now (revoked and
  // expired ones are excluded first, exactly as the guest/portal routes do
  // before resolveDocumentAccess), while expired ones are kept aside so the
  // matrix can still show and extend them instead of hiding them.
  const relGrants = selected?.grants ?? [];
  const liveGrants = useMemo(
    () => relGrants.filter((g) => grantStatus(g, now) !== 'expired' && !g.revoked_at) as MatrixGrant[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relGrants],
  );
  const expiredGrants = useMemo(
    () => relGrants.filter((g) => grantStatus(g, now) === 'expired') as RelationshipGrant[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relGrants],
  );

  function selectRelationship(key: string) {
    setSelectedKey(key);
    setGrantTargets([]);
    setExtendingGrantId(null);
    setNotice('');
  }

  function toggleFolder(id: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // One mechanism, not two: clicking a "Can't view" cell adds it to the
  // pending selection and opens the form; clicking more cells adds more.
  // Clicking one and pressing Grant is the pre-existing single-item flow,
  // unchanged from the founder's point of view.
  function toggleGrantTarget(target: GrantTarget) {
    setGrantTargets((prev) => {
      const without = prev.filter((t) => !(t.kind === target.kind && t.id === target.id));
      return without.length === prev.length ? [...prev, target] : without;
    });
  }

  async function notifyAccessChange(payload: {
    change: 'documents_added' | 'validity_extended'; documentNames?: string[]; documentCount?: number; expiresAt?: string;
  }) {
    // Every email the relationship is reachable at, deduplicated: one
    // grouped notification per recipient per action, never one per document.
    const emails = [...new Set([
      ...grantGuestEmails,
      ...grantPersonIds.map((id) => {
        const p = db.people.find((x) => x.id === id);
        return (p?.email_verified ?? p?.email_guess ?? '').trim().toLowerCase();
      }),
    ].filter(Boolean))];
    if (emails.length === 0) return;
    const results = await Promise.all(emails.map(async (email) => {
      try {
        const res = await fetch('/api/data-room/access-notify', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orgId: db.org.id, email, ...payload }),
        });
        const body = await res.json().catch(() => ({}));
        return body.ok && body.emailSent !== false;
      } catch { return false; }
    }));
    const sent = results.filter(Boolean).length;
    setNotice(sent > 0
      ? `${sent === 1 ? 'Recipient' : `${sent} recipients`} notified by email.`
      : 'Access updated — the recipient could not be emailed automatically.');
  }

  function confirmGrant() {
    if (grantTargets.length === 0 || !canGrant) return;
    const expires_at = grantExpiry ? `${grantExpiry}T23:59:59Z` : undefined;
    for (const target of grantTargets) {
      const shape = {
        document_id: target.kind === 'doc' ? target.id : undefined,
        folder_id: target.kind === 'folder' ? target.id : undefined,
        expires_at, nda_required: grantNda,
      };
      // Known people get person-scoped grants; an email-only relationship
      // keeps its invited_email, which is exactly what keeps the new grant
      // inside the SAME relationship (and inside the guest → registered
      // investor resolution) instead of spawning a second row.
      for (const personId of grantPersonIds) addGrant({ person_id: personId, ...shape });
      for (const email of grantGuestEmails) {
        const invitedName = relGrants.find((g) => g.invited_name)?.invited_name ?? undefined;
        addGrant({ ...shape, invited_email: email, invited_name: invitedName ?? undefined });
      }
    }
    const names = grantTargets.map((t) => t.name);
    setGrantTargets([]);
    setGrantNda(false);
    setGrantExpiry('');
    void notifyAccessChange({ change: 'documents_added', documentNames: names, documentCount: names.length });
  }

  /** Grants of this relationship that actually target one node, for revoke
   *  and extend. A folder grant is only matched by the folder cell — a
   *  document row never revokes the whole folder behind it. */
  function grantsForNode(kind: 'folder' | 'doc', id: string): RelationshipGrant[] {
    return relGrants.filter((g) => !g.revoked_at
      && (kind === 'doc' ? g.document_id === id : g.folder_id === id && !g.document_id));
  }

  async function revokeForItem(kind: 'folder' | 'doc', id: string, name: string) {
    const active = grantsForNode(kind, id);
    if (!active.length) return;
    const ok = await confirm({
      message: kind === 'doc'
        ? `Revoke access to "${name}" for ${selectedName}? Everything else stays shared.`
        : `Revoke the folder-level access to "${name}" for ${selectedName}? Documents shared individually stay shared.`,
      destructive: true,
    });
    if (!ok) return;
    active.forEach((g) => revokeGrant(g.id));
    setNotice(`Access to “${name}” revoked.`);
  }

  function applyExtension(grantIds: string[], iso: string | undefined) {
    grantIds.forEach((id) => extendGrant(id, iso));
    setExtendingGrantId(null);
    setExtendDate('');
    void notifyAccessChange({ change: 'validity_extended', expiresAt: iso });
  }

  const rootFolders = useMemo(() => db.folders.filter((f) => !f.parent_id), [db.folders]);
  const docsIn = (folderId: string) => db.documents.filter((d) => d.folder_id === folderId);
  const childFolders = (folderId: string) => db.folders.filter((f) => f.parent_id === folderId);

  const sections = useMemo(() => {
    const map = new Map<PortalSection | 'uncategorized', Folder[]>();
    for (const f of rootFolders) {
      const key = f.portal_section ?? 'uncategorized';
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    return map;
  }, [rootFolders]);

  // These are render FUNCTIONS, not nested components, and deliberately so:
  // a component declared inside PeopleAccessPanel gets a new function
  // identity on every render, which makes React unmount and remount its
  // whole subtree — the "extend" date input would lose focus on every
  // keystroke, because typing in it sets state on this component. Calling
  // them returns the same elements with no component boundary, the pattern
  // the IIFEs in this file already used.
  function dateHint(grant?: MatrixGrant) {
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

  /** The most specific EXPIRED grant behind a node whose live effect is
   *  "Can't view" — an expired grant stays visible so the founder can
   *  inspect it and extend it; it just doesn't open anything meanwhile
   *  (grantStatus, checked server-side by the guest and portal routes). */
  function expiredFor(documentId: string | undefined, folderId: string | undefined): RelationshipGrant | undefined {
    if (expiredGrants.length === 0) return undefined;
    return findEffectiveGrantAmong(expiredGrants as MatrixGrant[], documentId, folderId, folderTree) as RelationshipGrant | undefined;
  }

  function extendControl(grants: RelationshipGrant[], label: string) {
    const id = grants[0]?.id;
    if (!id) return null;
    const open = extendingGrantId === id;
    if (!open) {
      return (
        <button type="button"
          onClick={() => { setExtendingGrantId(id); setExtendDate(isoDateIn(30)); }}
          className="shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-[#0E7490] hover:bg-cyan-50">
          {label}
        </button>
      );
    }
    return (
      <span className="flex shrink-0 flex-wrap items-center gap-1">
        <input type="date" value={extendDate} onChange={(e) => setExtendDate(e.target.value)}
          className="rounded border border-gray-300 px-1 py-0.5 text-[10px]" />
        <button type="button" disabled={!extendDate}
          onClick={() => applyExtension(grants.map((g) => g.id), `${extendDate}T23:59:59Z`)}
          className="rounded bg-[#0E7490] px-1.5 py-0.5 text-[10px] font-medium text-white disabled:opacity-40">Save</button>
        <button type="button" onClick={() => applyExtension(grants.map((g) => g.id), undefined)}
          className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50"
          title="Access with no end date">No end date</button>
        <button type="button" onClick={() => setExtendingGrantId(null)} className="text-[10px] text-gray-400 hover:underline">Cancel</button>
      </span>
    );
  }

  /** One badge + its management actions, shared by folder rows and document
   *  rows so both behave identically. */
  function nodeCell({ kind, id, name, documentId, folderId, visibility }: {
    kind: 'folder' | 'doc'; id: string; name: string; documentId?: string; folderId?: string; visibility?: string;
  }) {
    const effective = findEffectiveGrantAmong(liveGrants, documentId, folderId, folderTree);
    const effect = computeCellEffect(effective, now, visibility);
    const expired = effect === 'not_shared' ? expiredFor(documentId, folderId) : undefined;
    const ownGrants = grantsForNode(kind, id);
    const ownExpired = ownGrants.filter((g) => grantStatus(g, now) === 'expired');
    const ownLive = ownGrants.filter((g) => grantStatus(g, now) !== 'expired');
    const pendingTarget = grantTargets.some((t) => t.kind === kind && t.id === id);

    const badgeCls = `shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${EFFECT_STYLE[effect]}`;

    return (
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {expired ? (
          <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800"
            title="The grant is still on the record — the recipient cannot open the document while it is expired.">
            Expired grant{dateHint(expired)}
          </span>
        ) : effect === 'no_effect_private' ? (
          <span className={badgeCls}>{EFFECT_LABEL[effect]}</span>
        ) : effect === 'not_shared' ? (
          <button type="button" disabled={!canGrant}
            title={canGrant ? `Add "${name}" to what ${selectedName} can see` : 'No known recipient in this relationship yet'}
            onClick={() => toggleGrantTarget({ kind, id, name })}
            className={`${badgeCls} ${canGrant ? 'cursor-pointer hover:ring-1 hover:ring-[#0E7490]' : 'cursor-not-allowed'} ${pendingTarget ? 'ring-1 ring-[#0E7490]' : ''}`}>
            {pendingTarget ? '+ Selected' : EFFECT_LABEL[effect]}
          </button>
        ) : (
          <span className={badgeCls}>
            {EFFECT_LABEL[effect]}
            {/* Where the access actually comes from. A document covered by a
                folder grant has no grant of its own to revoke — saying so
                is the honest answer, and points at the control that does
                exist (Revoke on the folder row). The grant model has no
                per-document exception to a folder grant, and inventing one
                here would be a second access model. */}
            {kind === 'doc' && effective && !effective.document_id && effective.folder_id && (
              <span className="ml-1.5 text-[9px] font-normal text-gray-500">
                via {db.folders.find((f) => f.id === effective.folder_id)?.name ?? 'folder'}
              </span>
            )}
            {dateHint(effective)}
          </span>
        )}

        {/* Extend covers both cases the spec names: an active grant's
            validity moved out, and an expired one brought back. Same
            column, same row, same in-place update. */}
        {ownExpired.length > 0 && extendControl(ownExpired, 'Extend / reactivate')}
        {ownExpired.length === 0 && ownLive.length > 0 && ownLive.some((g) => g.expires_at) && extendControl(ownLive, 'Extend')}
        {ownLive.length > 0 && (
          <button type="button" onClick={() => revokeForItem(kind, id, name)}
            className="shrink-0 rounded border border-red-200 px-1.5 py-0.5 text-[10px] font-medium text-[#B00000] hover:bg-red-50"
            title={kind === 'doc' ? `Revoke access to "${name}" only` : `Revoke the folder-level grant on "${name}"`}>
            Revoke
          </button>
        )}
      </span>
    );
  }

  /** A folder and everything under it, collapsible. Recursive so the matrix
   *  follows the real Vault/Data Room tree rather than flattening it. */
  function folderBlock(folder: Folder, depth: number) {
    const docs = docsIn(folder.id);
    const subs = childFolders(folder.id);
    const collapsed = collapsedFolders.has(folder.id);
    return (
      <div key={folder.id} className={`rounded-lg border border-gray-100 p-2 ${depth > 0 ? 'mt-1.5' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={() => toggleFolder(folder.id)}
            className="flex min-w-0 items-center gap-1 text-left text-sm font-medium text-gray-800 hover:text-[#0E7490]"
            aria-expanded={!collapsed}>
            <span className="text-gray-400">{collapsed ? '▶' : '▼'}</span>
            <span className="truncate">{folder.name}</span>
            {(docs.length > 0 || subs.length > 0) && (
              <span className="text-[10px] font-normal text-gray-400">
                {docs.length > 0 && `${docs.length} file${docs.length === 1 ? '' : 's'}`}
                {docs.length > 0 && subs.length > 0 && ' · '}
                {subs.length > 0 && `${subs.length} folder${subs.length === 1 ? '' : 's'}`}
              </span>
            )}
          </button>
          {nodeCell({ kind: 'folder', id: folder.id, name: folder.name, folderId: folder.id })}
        </div>
        {!collapsed && (docs.length > 0 || subs.length > 0) && (
          <div className="mt-1.5 border-t border-gray-50 pt-1.5">
            {docs.length > 0 && (
              <ul className="space-y-1">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-2 pl-4 text-xs">
                    <span className="min-w-0 text-gray-600">
                      {d.name}
                      {d.details && <span className="block text-[10px] text-gray-400">{d.details}</span>}
                    </span>
                    {nodeCell({ kind: 'doc', id: d.id, name: d.name, documentId: d.id, folderId: folder.id, visibility: d.visibility })}
                  </li>
                ))}
              </ul>
            )}
            {subs.map((sub) => <div key={sub.id} className="pl-3">{folderBlock(sub, depth + 1)}</div>)}
          </div>
        )}
      </div>
    );
  }

  const porAssociarCount = relationships.filter((r) => r.status === 'por_associar').length;

  function relationshipRow(rel: AccessRelationship) {
    const selectedRow = selectedKey === rel.key;
    const amber = rel.status === 'por_associar';
    return (
      <li key={rel.key}>
        <button onClick={() => selectRelationship(rel.key)}
          className={`block w-full rounded px-2 py-1.5 text-left ${selectedRow
            ? 'bg-[#E8F4F8] ring-1 ring-[#0E7490]'
            : amber ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-gray-50'}`}>
          <span className={`block truncate text-sm ${selectedRow ? 'font-medium text-[#0E7490]' : amber ? 'font-medium text-amber-900' : 'text-gray-700'}`}>
            {rel.name}
          </span>
          {rel.secondary && <span className={`block truncate text-[10px] ${amber ? 'text-amber-600' : 'text-gray-400'}`}>{rel.secondary}</span>}
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className={`text-[11px] ${rel.fileCount > 0 ? 'text-[#0E7490]' : 'text-gray-400'}`}>
              {rel.fileCount} {rel.fileCount === 1 ? 'file' : 'files'} granted · {rel.peopleCount} {rel.peopleCount === 1 ? 'person' : 'people'}
            </span>
            {amber && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">Por associar</span>}
            {rel.hasExpiredGrant && <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-800">Expired grant</span>}
          </span>
        </button>
      </li>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div data-tour-id="people-entities">
      <Card title="Entities">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search entity, person or email…" aria-label="Search entities"
          className="mb-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />

        {porAssociarCount > 0 && (
          <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
            <span className="font-semibold">Por associar ({porAssociarCount})</span> — shared by email, not yet matched to an
            investor in your pipeline. They stay one relationship: when they sign up with the same address, their access follows them.
          </p>
        )}

        {!query_ && <p className="mb-1.5 text-[11px] text-gray-400">Showing everyone with access. Search to find any other entity in your pipeline.</p>}

        <ul className="space-y-0.5">
          {visibleRelationships.map((rel) => relationshipRow(rel))}

          {pipelineOnlyRows.map((e) => (
            <li key={`pipeline:${e.id}`}>
              <button onClick={() => selectRelationship(`entity:${e.id}`)}
                className={`block w-full rounded px-2 py-1.5 text-left text-sm ${selectedKey === `entity:${e.id}` ? 'bg-[#E8F4F8] font-medium text-[#0E7490] ring-1 ring-[#0E7490]' : 'text-gray-700 hover:bg-gray-50'}`}>
                <span className="block truncate">{e.name}</span>
                <span className="text-[11px] text-gray-300">no access yet</span>
              </button>
            </li>
          ))}

          {visibleRelationships.length === 0 && pipelineOnlyRows.length === 0 && (
            <p className="text-xs text-gray-400">
              {query_ ? 'No matching entities found.' : 'No entity has any access yet — search to pick one from your pipeline.'}
            </p>
          )}
        </ul>
      </Card>
      </div>

      <div className="md:col-span-2" data-tour-id="people-matrix">
        <Card title={selectedName ? `Access matrix — ${selectedName}` : 'Access matrix'}>
          {!selected && !selectedPipelineEntity ? (
            <p className="text-sm text-gray-400">Pick an entity on the left to see what it can see.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                {selected ? (
                  <>
                    <span>
                      <span className="font-medium text-gray-600">{selected.fileCount}</span> {selected.fileCount === 1 ? 'file' : 'files'} granted
                      {' · '}
                      <span className="font-medium text-gray-600">{selected.peopleCount}</span> {selected.peopleCount === 1 ? 'person' : 'people'}
                    </span>
                    {selected.personNames.length > 0 && <span>{selected.personNames.join(', ')}</span>}
                    {selected.guestEmails.length > 0 && <span>{selected.guestEmails.join(', ')}</span>}
                    {selected.status === 'por_associar' && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Por associar</span>
                    )}
                  </>
                ) : (
                  <span>No access yet — click any “Can’t view” badge to start sharing with {selectedName}.</span>
                )}
              </div>

              {notice && <p className="text-xs text-gray-500">{notice}</p>}

              {grantTargets.length > 0 && (
                <div className="rounded-lg border border-[#0E7490] bg-cyan-50 p-3">
                  <p className="text-xs font-medium text-[#0E7490]">
                    Grant {grantTargets.length === 1 ? `“${grantTargets[0].name}”` : `${grantTargets.length} items`} to {selectedName}
                  </p>
                  {grantTargets.length > 1 && (
                    <p className="mt-0.5 text-[10px] text-cyan-800">{grantTargets.map((t) => t.name).join(', ')}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600">
                      <input type="checkbox" checked={grantNda} onChange={(e) => setGrantNda(e.target.checked)} />
                      Requires NDA
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-gray-600">
                      Expires
                      <input type="date" value={grantExpiry} onChange={(e) => setGrantExpiry(e.target.value)} className="rounded border border-gray-300 px-1.5 py-0.5 text-xs" />
                    </label>
                    <button onClick={confirmGrant} className="rounded-lg bg-[#0E7490] px-3 py-1 text-xs font-medium text-white">
                      Grant access
                    </button>
                    <button onClick={() => setGrantTargets([])} className="text-xs text-gray-400 hover:underline">Cancel</button>
                  </div>
                  <p className="mt-1.5 text-[10px] text-cyan-800">Keep clicking “Can’t view” badges to add more before granting. The recipient gets one email, not one per file.</p>
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
                      {folders.map((f) => folderBlock(f, 0))}
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
