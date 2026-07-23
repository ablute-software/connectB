'use client';
// Documents & Data Room — folder tree, documents with visibility attributes, grants, engagement
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { authEnabled, browserClient } from '@/lib/supabase';
import { Card, PersonLink } from '@/components/ui';
import type { Folder } from '@/lib/types';
import { normalizeDocumentUrl, sanitizeStorageKey } from '@/lib/data-room';

function fmtBytes(n?: number): string | undefined {
  if (n == null) return undefined;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1000) return `${Math.round(n / 1000)} KB`;
  return `${n} B`;
}

export default function DocumentsPage() {
  const { db, addDocument, addGrant, revokeGrant } = useStore();
  const [selFolder, setSelFolder] = useState<string>('');
  const [storageSizes, setStorageSizes] = useState<Record<string, number>>({});

  // Folder ids differ between demo seed data and real Supabase UUIDs, so the
  // default can't be a hardcoded id — pick "Investor deck" by name once
  // folders have loaded, falling back to whatever folder exists first.
  useEffect(() => {
    if (selFolder || db.folders.length === 0) return;
    const preferred = db.folders.find((f) => f.name === 'Investor deck') ?? db.folders[0];
    if (preferred) setSelFolder(preferred.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.folders]);
  const [docName, setDocName] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [docErr, setDocErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [grantDoc, setGrantDoc] = useState('');
  const [grantPerson, setGrantPerson] = useState('');
  const [grantFolder, setGrantFolder] = useState('');
  const [grantExpiry, setGrantExpiry] = useState('');
  const [grantNda, setGrantNda] = useState(false);

  const roots = db.folders.filter((f) => !f.parent_id).sort((a, b) => a.position - b.position);
  const children = (id: string) => db.folders.filter((f) => f.parent_id === id).sort((a, b) => a.position - b.position);
  const docsIn = (id: string) => db.documents.filter((d) => d.folder_id === id);
  const activeGrants = db.grants.filter((g) => !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > new Date()));

  // File size isn't a DB column — Supabase Storage already tracks it, so a
  // single listing of the org's prefix is cheaper than a schema change.
  useEffect(() => {
    if (!authEnabled || !db.org.id) return;
    browserClient().storage.from('data-room').list(db.org.id, { limit: 1000 }).then(({ data, error }) => {
      if (error || !data) return;
      const map: Record<string, number> = {};
      for (const item of data) if (item.metadata?.size != null) map[`${db.org.id}/${item.name}`] = item.metadata.size;
      setStorageSizes(map);
    });
  }, [db.org.id, db.documents.length]);

  async function uploadFile(file: File) {
    setUploadErr(''); setUploading(true);
    try {
      const sb = browserClient();
      const path = `${db.org.id}/${crypto.randomUUID()}-${sanitizeStorageKey(file.name)}`;
      const { error } = await sb.storage.from('data-room').upload(path, file);
      if (error) throw error;
      addDocument({
        folder_id: selFolder, name: file.name, storage_path: path,
        is_view_only: true, visibility: 'on_grant', watermark: false, downloadable: false,
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e) {
      setUploadErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function openStored(storagePath: string) {
    const sb = browserClient();
    const { data, error } = await sb.storage.from('data-room').createSignedUrl(storagePath, 60);
    if (error) { alert(`Could not open file: ${error.message}`); return; }
    window.open(data.signedUrl, '_blank');
  }

  function FolderNode({ f, depth }: { f: Folder; depth: number }) {
    const kids = children(f.id);
    return (
      <div>
        <button onClick={() => setSelFolder(f.id)}
          className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm ${selFolder === f.id ? 'bg-[#E8F4F8] font-medium text-[#0E7490]' : 'text-gray-700 hover:bg-gray-50'}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}>
          <span>{f.kind === 'data_room' ? '▣' : '▤'}</span> {f.name}
          <span className="ml-auto text-[10px] text-gray-400">{docsIn(f.id).length || ''}</span>
        </button>
        {kids.map((k) => <FolderNode key={k.id} f={k} depth={depth + 1} />)}
      </div>
    );
  }

  const selected = db.folders.find((f) => f.id === selFolder);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Documents & Data Room</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Folders">
          {roots.map((f) => <FolderNode key={f.id} f={f} depth={0} />)}
        </Card>

        <div className="space-y-4 md:col-span-2">
          <Card title={`Documents in “${selected?.name ?? ''}”`}>
            {docsIn(selFolder).length === 0 ? <p className="text-sm text-gray-400">Empty.</p> : (
              <ul className="divide-y divide-gray-100">
                {docsIn(selFolder).map((d) => {
                  const grants = activeGrants.filter((g) => g.document_id === d.id || g.folder_id === d.folder_id);
                  const views = db.views.filter((v) => v.document_id === d.id);
                  const size = d.storage_path ? fmtBytes(storageSizes[d.storage_path]) : undefined;
                  return (
                    <li key={d.id} className="py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{d.name}</span>
                        {d.version && <span className="text-xs text-gray-400">{d.version}</span>}
                        {d.is_view_only
                          ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-800">view-only ✓</span>
                          : <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800">not view-only — blocked from sharing</span>}
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{d.visibility}</span>
                        <span className="text-xs text-gray-400">
                          {d.storage_path ? 'file' : 'link'}{size && ` · ${size}`}
                          {d.created_at && ` · uploaded ${d.created_at.slice(0, 10)}`}
                        </span>
                        <button
                          onClick={() => d.storage_path ? openStored(d.storage_path!) : window.open(d.external_url, '_blank')}
                          className="ml-auto rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">
                          Open
                        </button>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {grants.length} active grant(s) · {views.length} view(s)
                        {views.length > 0 && ` · last ${views[views.length - 1].viewed_at.slice(0, 16).replace('T', ' ')}`}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-3 border-t border-gray-100 pt-3">
              <div className="text-xs font-medium text-gray-500">Add document (link)</div>
              <div className="mt-1 flex flex-wrap gap-2">
                <input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Name"
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                <input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="View-only URL"
                  className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm" />
                <button disabled={!docName || !docUrl}
                  onClick={() => {
                    setDocErr('');
                    try {
                      addDocument({
                        folder_id: selFolder, name: docName, external_url: docUrl,
                        is_view_only: !docUrl.includes('/edit'), visibility: 'on_grant',
                        watermark: false, downloadable: false,
                      });
                      setDocName(''); setDocUrl('');
                    } catch (e) { setDocErr((e as Error).message); }
                  }}
                  className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Add</button>
              </div>
              {docErr && <div className="mt-1 text-xs text-[#B00000]">{docErr}</div>}
              {(() => {
                if (!docUrl) return null;
                const normalized = normalizeDocumentUrl(docUrl);
                if (normalized.includes('/edit')) {
                  return <div className="mt-1 text-xs text-[#B00000]">✗ Editable link — will be rejected. Get the view/share version.</div>;
                }
                if (normalized !== docUrl) {
                  return <div className="mt-1 text-xs text-green-700">✓ Google link detected — will be saved as a view-only link automatically.</div>;
                }
                return null;
              })()}
            </div>

            {authEnabled && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="text-xs font-medium text-gray-500">Or upload a file</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <input ref={fileInputRef} type="file" disabled={uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
                    className="text-sm" />
                  {uploading && <span className="text-xs text-gray-400">Uploading…</span>}
                </div>
                {uploadErr && <div className="mt-1 text-xs text-[#B00000]">{uploadErr}</div>}
              </div>
            )}
          </Card>

          <Card title="Access grants — the owner consents, access follows">
            {activeGrants.length === 0 ? <p className="text-sm text-gray-400">No active grants. Grant access as conversations advance to diligence.</p> : (
              <ul className="divide-y divide-gray-100 text-sm">
                {activeGrants.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span>
                      {g.person_id ? <PersonLink id={g.person_id}>{db.people.find((p) => p.id === g.person_id)?.full_name}</PersonLink> : g.grantee_email}
                    </span>
                    <span className="text-xs text-gray-500">
                      → {g.document_id ? db.documents.find((d) => d.id === g.document_id)?.name : db.folders.find((f) => f.id === g.folder_id)?.name}
                    </span>
                    {g.expires_at && <span className="text-xs text-gray-400">until {g.expires_at.slice(0, 10)}</span>}
                    {g.nda_required && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${g.nda_accepted_at ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                      NDA {g.nda_accepted_at ? 'accepted' : 'pending'}</span>}
                    <button onClick={() => revokeGrant(g.id)} className="ml-auto rounded border border-red-200 px-2 py-0.5 text-xs text-[#B00000] hover:bg-red-50">Revoke</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 border-t border-gray-100 pt-3">
              <div className="text-xs font-medium text-gray-500">Grant access</div>
              <div className="mt-1 flex flex-wrap gap-2">
                <select value={grantPerson} onChange={(e) => setGrantPerson(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="">Person…</option>
                  {db.people.filter((p) => !p.do_not_contact).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
                <select value={grantDoc} onChange={(e) => { setGrantDoc(e.target.value); setGrantFolder(''); }} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="">Document…</option>
                  {db.documents.filter((d) => d.is_view_only).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <span className="self-center text-xs text-gray-400">or</span>
                <select value={grantFolder} onChange={(e) => { setGrantFolder(e.target.value); setGrantDoc(''); }} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="">Folder…</option>
                  {db.folders.filter((f) => f.kind === 'data_room').map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <input type="date" value={grantExpiry} onChange={(e) => setGrantExpiry(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm" title="Expiry (optional)" />
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  <input type="checkbox" checked={grantNda} onChange={(e) => setGrantNda(e.target.checked)} /> NDA required
                </label>
                <button disabled={!grantPerson || (!grantDoc && !grantFolder)}
                  onClick={() => {
                    addGrant({
                      person_id: grantPerson, document_id: grantDoc || undefined, folder_id: grantFolder || undefined,
                      expires_at: grantExpiry ? `${grantExpiry}T23:59:59Z` : undefined, nda_required: grantNda,
                    });
                    setGrantPerson(''); setGrantDoc(''); setGrantFolder(''); setGrantExpiry(''); setGrantNda(false);
                  }}
                  className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Grant</button>
              </div>
              <p className="mt-2 text-[11px] text-gray-400">
                Granting fires the “grant activated” automation: an access email drafts (or sends, in full-auto) and every
                view is logged back to the entity. Investors sign in via magic link and see only their granted items.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
