'use client';
// Prompt 278 §3 — "Who has access to this", scoped to whichever folder is
// currently selected in the Folders tree (documents/page.tsx's own
// selFolder) — deliberately NOT a second "Granted so far" (that panel
// lists grants by person, across the whole data room; this one answers
// "for THIS specific folder, who can actually see it, and how much of
// it").
//
// Prompt 669 §3 — rewritten to read grants the same way "Access grants"
// (buildAccessRelationships) does: by PERSON OR BY EMAIL, not by person_id
// alone. The old version called findEffectiveGrant, which — exactly as its
// own Prompt 530 comment documents — silently drops any grant with no
// person_id (a guest invite addressed straight to an email: grantee_email/
// invited_email set, person_id null). That is precisely how
// alexandrameira@hotmail.com's grant on "ablute_ investor deck" went
// invisible here while it correctly appeared in "Access grants" above it
// on the same page — the query genuinely wasn't reading that grant at all,
// not a display choice. Now built from the SAME relationship grouping, so
// the two panels can no longer disagree about who has a grant reaching
// this folder.
//
// It also now explains a "grant exists but has no effect right now" case
// instead of silently omitting it, which is what Nuno actually hit here:
// Tomás/nunomarujo@gmail.com's three grants had all expired (11 days
// before he looked), and both his and Alexandra's grants target a document
// whose own visibility is locked to "Due diligence only" — a state
// computeCellEffect treats as no grant can ever have effect, regardless of
// the grant's own status (people-access-matrix.ts). Previously that read
// as "no investor has access to this folder yet", indistinguishable from
// "nobody was ever granted anything" — now it names who has a grant here
// and why it isn't live, which is the honest answer and the one that tells
// the founder what to do next (extend it, or move the document off Due
// diligence / approve an access request).
import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { computeCellEffect, findEffectiveGrantAmong, CELL_EFFECT_STYLE, CELL_EFFECT_LABEL } from '@/lib/people-access-matrix';
import { grantStatus } from '@/lib/access-grants';
import { buildAccessRelationships, type RelationshipGrant } from '@/lib/data-room-access-relationships';

type AccessRow =
  | { key: string; name: string; kind: 'complete'; effectLabel: string; effectClass: string }
  | { key: string; name: string; kind: 'partial'; partialDocNames: string[] }
  // A grant reaches this folder/its documents but currently has no effect.
  | { key: string; name: string; kind: 'blocked_due_diligence' }
  | { key: string; name: string; kind: 'expired' };

export function WhoHasAccessPanel({ folderId }: { folderId: string }) {
  const { db } = useStore();
  const folder = db.folders.find((f) => f.id === folderId);
  const folderTree = useMemo(() => db.folders.map((f) => ({ id: f.id, parent_id: f.parent_id })), [db.folders]);
  const docsInFolder = useMemo(() => db.documents.filter((d) => d.folder_id === folderId), [db.documents, folderId]);
  const now = new Date();

  // The exact grouping "Access grants" reads (buildAccessRelationships),
  // so a relationship this panel finds is a relationship that panel would
  // also show — by person, by an email a known person carries, or by a
  // guest email with no person/entity at all (alexandrameira's case).
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

  const rows = useMemo(() => {
    if (!folderId) return [] as AccessRow[];
    const out: AccessRow[] = [];
    for (const rel of relationships) {
      // Same population "Access grants" keeps visible: every non-revoked
      // grant, expired ones included — computeCellEffect/grantStatus below
      // are what turn an expired one into "not shared", not a filter here.
      const live = rel.grants.filter((g) => !g.revoked_at);
      if (live.length === 0) continue;

      const folderGrant = findEffectiveGrantAmong(live, undefined, folderId, folderTree);
      const folderEffect = folderGrant ? computeCellEffect(folderGrant, now) : 'not_shared';
      if (folderEffect === 'shared' || folderEffect === 'shared_pending_nda' || folderEffect === 'shared_pending_confirmation') {
        out.push({ key: rel.key, name: rel.name, kind: 'complete', effectLabel: CELL_EFFECT_LABEL[folderEffect], effectClass: CELL_EFFECT_STYLE[folderEffect] });
        continue;
      }

      const accessibleDocs: string[] = [];
      let reachedBlocked = false;
      let reachedExpired = !!folderGrant && grantStatus(folderGrant, now) === 'expired';
      let reachedAny = !!folderGrant;
      for (const doc of docsInFolder) {
        const g = findEffectiveGrantAmong(live, doc.id, folderId, folderTree);
        if (!g) continue;
        reachedAny = true;
        const effect = computeCellEffect(g, now, doc.visibility);
        if (effect === 'shared' || effect === 'shared_pending_nda' || effect === 'shared_pending_confirmation') {
          accessibleDocs.push(doc.name);
        } else if (effect === 'no_effect_private') {
          reachedBlocked = true;
        } else if (grantStatus(g, now) === 'expired') {
          reachedExpired = true;
        }
      }

      if (accessibleDocs.length > 0) {
        out.push({ key: rel.key, name: rel.name, kind: 'partial', partialDocNames: accessibleDocs });
      } else if (reachedBlocked) {
        // The more complete explanation when both apply: changing the
        // document's visibility (or approving an access request) is what
        // unlocks it — extending an expired grant alone would not.
        out.push({ key: rel.key, name: rel.name, kind: 'blocked_due_diligence' });
      } else if (reachedAny && reachedExpired) {
        out.push({ key: rel.key, name: rel.name, kind: 'expired' });
      }
      // Otherwise no grant of this relationship reaches this folder or any
      // document inside it at all — correctly not shown, as before.
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relationships, folderId, docsInFolder, folderTree]);

  if (!folder) return null;

  return (
    <Card title={`Who has access — ${folder.name}`}>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">No investor has access to this folder yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="font-medium text-gray-800">{r.name}</span>
              {r.kind === 'complete' && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.effectClass}`}>
                  {r.effectLabel === '✓ Can view' ? 'Complete access to folder' : r.effectLabel}
                </span>
              )}
              {r.kind === 'partial' && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800"
                  title={r.partialDocNames.join(', ')}>
                  Access to {r.partialDocNames.length} partial doc{r.partialDocNames.length === 1 ? '' : 's'} in this folder
                </span>
              )}
              {r.kind === 'blocked_due_diligence' && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500"
                  title="Change the document's visibility off Due diligence only, or approve an access request, to let this grant take effect.">
                  Granted, but blocked — Due diligence only
                </span>
              )}
              {r.kind === 'expired' && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-800">
                  Access expired
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
