'use client';
// Prompt 893 §A — the unified "Files" tab: the Pipeline panel's own
// "Shared with this investor" card, plus the full dossier's "NDAs on
// file" and "Data room engagement" cards, merged into ONE self-contained
// component so both surfaces render byte-identical content instead of two
// hand-maintained copies. Takes only `entityId` (same convention as
// EntityPeoplePanel) and resolves everything else itself — the effective-
// grant/sharedDocs computation this used to duplicate between
// EntityDossierPanel.tsx and entities/[id]/page.tsx now has exactly one
// definition.
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { browserClient } from '@/lib/supabase';
import { findEffectiveGrant, computeCellEffect } from '@/lib/people-access-matrix';

export function FilesTab({ entityId }: { entityId: string }) {
  const { db } = useStore();
  const people = db.people.filter((p) => p.entity_id === entityId);
  const personIds = new Set(people.map((p) => p.id));
  const folderTree = db.folders.map((f) => ({ id: f.id, parent_id: f.parent_id }));
  const grants = db.grants.filter((g) => people.some((p) => p.id === g.person_id));
  const views = db.views.filter((v) => grants.some((g) => g.id === v.grant_id)
    || people.some((p) => p.email_verified && p.email_verified === v.viewer_email));
  const sharedDocs = personIds.size === 0 ? [] : db.documents.filter((d) => {
    const g = findEffectiveGrant(db.grants, d.id, d.folder_id, personIds, folderTree);
    const effect = computeCellEffect(g, new Date(), d.visibility, d.nda_by_default);
    return effect === 'shared' || effect === 'shared_pending_nda' || effect === 'shared_pending_confirmation';
  });
  const ndas = db.ndas.filter((n) => n.entity_id === entityId);
  // Prompt 894 §C — "Onde aparece: Files (do investidor) -> 'Deal memo ·
  // <data>'." This is the FOUNDER's own Files tab for this investor's
  // dossier, not the investor-facing portal — the memo's visibility stays
  // 'due_diligence' (never shared by default) regardless of it showing up
  // here; nothing below grants the investor access to it.
  const memos = db.documents.filter((d) => d.kind === 'deal_memo' && d.entity_id === entityId)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

  return (
    <div className="space-y-4">
      {memos.length > 0 && (
        <Card title="Deal memo">
          <ul className="space-y-1 text-sm">
            {memos.map((m) => (
              <li key={m.id} className="text-gray-700">{m.name}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-gray-400">Archived, private — never shared with the investor by default. See Terms on the table (Conversation tab) for the full memo.</p>
        </Card>
      )}
      <Card title="Shared with this investor">
        {sharedDocs.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing shared yet. Documents you share appear here.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {sharedDocs.map((d) => <li key={d.id} className="py-1.5 text-gray-700">{d.name}</li>)}
          </ul>
        )}
        <Link href="/documents" className="mt-2 inline-block text-xs text-cyan-700 hover:underline">+ Share a document →</Link>
      </Card>

      {ndas.length > 0 && (
        <Card title="NDAs on file">
          <ul className="space-y-2 text-sm">
            {ndas.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-2">
                <span>{n.file_name ?? 'NDA'}</span>
                <span className="text-xs text-gray-400">
                  uploaded {n.uploaded_at.slice(0, 10)}{n.uploaded_by ? ` by ${n.uploaded_by}` : ''}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  n.match_status === 'match' ? 'bg-green-100 text-green-800'
                  : n.match_status === 'mismatch' ? 'bg-red-100 text-[#B00000]'
                  : 'bg-amber-100 text-amber-800'}`} title={n.match_notes}>
                  {n.match_status === 'match' ? 'AI check: match' : n.match_status === 'mismatch' ? 'AI check: mismatch — verify' : 'AI check: uncertain'}
                </span>
                <button
                  onClick={async () => {
                    const sb = browserClient();
                    const { data, error } = await sb.storage.from('data-room').createSignedUrl(n.storage_path, 60);
                    if (error) { alert(`Could not open file: ${error.message}`); return; }
                    window.open(data.signedUrl, '_blank');
                  }}
                  className="ml-auto rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">
                  Open
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(grants.length > 0 || views.length > 0) && (
        <Card title="Data room engagement">
          <div className="text-sm text-gray-600">
            {grants.filter((g) => !g.revoked_at).length} active grant(s) · {views.length} view(s)
          </div>
          {views.slice(-3).reverse().map((v) => (
            <div key={v.id} className="mt-1 text-xs text-gray-500">
              {db.documents.find((d) => d.id === v.document_id)?.name} — {v.viewed_at.slice(0, 16).replace('T', ' ')}
              {v.seconds ? ` · ${Math.round(v.seconds / 60)} min` : ''}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
