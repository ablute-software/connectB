'use client';
// Prompt 372 Block D/E — "Ver pedido": the Log interaction pre-filled with
// the investor's own request text, and every item answered one at a time.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { uploadAndVerifyFile } from '@/lib/vault-upload-client';
import type { DocVisibility } from '@/lib/types';

interface Item {
  id: string; documentId: string | null; label: string; status: 'pending' | 'granted' | 'promised' | 'declined';
  fulfilledDocumentId: string | null; promisedFor: string | null; declineReason: string | null; resolutionNote: string | null;
}
interface RequestDetail {
  id: string; requesterName: string | null; requesterEmail: string | null; entityId: string | null;
  message: string | null; requestedAt: string; items: Item[];
}

const VISIBILITY_OPTIONS: { v: DocVisibility; l: string }[] = [
  { v: 'open', l: '🟢 Open' }, { v: 'on_grant', l: '🟡 On request' }, { v: 'due_diligence', l: '🔴 Due diligence only' },
];

export default function DocumentRequestReviewPage({ params }: { params: { id: string } }) {
  const { db } = useStore();
  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [mode, setMode] = useState<Record<string, 'grant' | 'upload' | 'promise' | 'decline' | null>>({});

  function load() {
    fetch(`/api/founder/document-requests?id=${params.id}`).then((r) => r.json())
      .then((body) => setRequest((body.requests ?? [])[0] ?? null)).catch(() => {});
  }
  useEffect(load, [params.id]);

  async function respond(itemId: string, action: string, extra: Record<string, unknown> = {}) {
    setBusyItemId(itemId);
    try {
      await fetch('/api/founder/document-requests/respond', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId, action, ...extra }),
      });
      setMode((m) => ({ ...m, [itemId]: null }));
      load();
    } finally { setBusyItemId(null); }
  }

  if (!request) return <p className="text-sm text-gray-400">Loading…</p>;

  const requestText = `Document request: ${request.items.map((i) => i.label).join(', ')}.${request.message ? ` "${request.message}"` : ''}`;
  const logHref = request.entityId
    ? `/log?entity=${request.entityId}&direction=in&date=${new Date().toISOString().slice(0, 10)}&content=${encodeURIComponent(requestText)}`
    : null;

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Document request</h1>
        <p className="text-sm text-gray-500">
          From {request.requesterName ?? request.requesterEmail ?? 'an investor'} · {request.requestedAt.slice(0, 10)}
        </p>
        {request.message && <p className="mt-1 rounded-lg bg-gray-50 p-2 text-sm text-gray-700">&ldquo;{request.message}&rdquo;</p>}
        {logHref && (
          <Link href={logHref} className="mt-2 inline-block text-xs font-medium text-[#0E7490] hover:underline">
            📝 Log this request as an interaction →
          </Link>
        )}
      </div>

      <div className="space-y-3">
        {request.items.map((item) => (
          <Card key={item.id}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900">{item.label}</span>
              <StatusBadge item={item} />
            </div>

            {item.status === 'pending' && (
              <div className="mt-2 space-y-2">
                {!mode[item.id] && (
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => setMode((m) => ({ ...m, [item.id]: 'grant' }))} className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">📁 It&apos;s in the Vault</button>
                    <button onClick={() => setMode((m) => ({ ...m, [item.id]: 'upload' }))} className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">⬆️ Upload from my computer</button>
                    <button onClick={() => setMode((m) => ({ ...m, [item.id]: 'promise' }))} className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">🕒 Not yet</button>
                    <button onClick={() => setMode((m) => ({ ...m, [item.id]: 'decline' }))} className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">🚫 I won&apos;t share this</button>
                  </div>
                )}
                {mode[item.id] === 'grant' && (
                  <GrantExisting docs={db.documents} entityId={request.entityId} busy={busyItemId === item.id}
                    onCancel={() => setMode((m) => ({ ...m, [item.id]: null }))}
                    onGrant={(documentId) => respond(item.id, 'grant_existing', { documentId })} />
                )}
                {mode[item.id] === 'upload' && (
                  <UploadNew orgId={db.org.id} folders={db.folders} busy={busyItemId === item.id} itemId={item.id}
                    onCancel={() => setMode((m) => ({ ...m, [item.id]: null }))}
                    onDone={() => { setMode((m) => ({ ...m, [item.id]: null })); load(); }}
                    onFulfilledViaMessage={(note) => respond(item.id, 'fulfill_via_message', { resolutionNote: note })} />
                )}
                {mode[item.id] === 'promise' && (
                  <PromiseDate busy={busyItemId === item.id}
                    onCancel={() => setMode((m) => ({ ...m, [item.id]: null }))}
                    onPromise={(date) => respond(item.id, 'promise', { promisedFor: date })} />
                )}
                {mode[item.id] === 'decline' && (
                  <DeclineReason busy={busyItemId === item.id}
                    onCancel={() => setMode((m) => ({ ...m, [item.id]: null }))}
                    onDecline={(reason) => respond(item.id, 'decline', { declineReason: reason })} />
                )}
              </div>
            )}
            {item.status === 'promised' && item.promisedFor && <p className="mt-1 text-xs text-gray-500">Promised for {item.promisedFor}.</p>}
            {item.status === 'declined' && item.declineReason && <p className="mt-1 text-xs text-gray-500">Reason: {item.declineReason}</p>}
            {item.status === 'granted' && item.resolutionNote && <p className="mt-1 text-xs text-gray-500">{item.resolutionNote}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ item }: { item: Item }) {
  const style: Record<Item['status'], string> = {
    pending: 'bg-amber-100 text-amber-800', granted: 'bg-emerald-100 text-emerald-800',
    promised: 'bg-cyan-100 text-cyan-800', declined: 'bg-red-100 text-red-800',
  };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${style[item.status]}`}>{item.status}</span>;
}

function GrantExisting({ docs, entityId, busy, onCancel, onGrant }: {
  docs: { id: string; name: string; visibility?: DocVisibility }[]; entityId: string | null; busy: boolean;
  onCancel: () => void; onGrant: (documentId: string) => void;
}) {
  const [docId, setDocId] = useState('');
  const selected = docs.find((d) => d.id === docId);
  const needsNda = selected?.visibility === 'due_diligence';
  // Block F — granting a due_diligence document here still locks it behind
  // an NDA (respond/route.ts sets nda_required on the grant it creates);
  // this link drafts the request message but never sends it — the founder
  // reviews it in the composer and presses Send themselves.
  const ndaDraftHref = entityId && selected
    ? `/entities/${entityId}?ndaDraft=${encodeURIComponent(`Before I can share "${selected.name}", I'll need a signed NDA on file for it. Happy to send ours over, or use yours — whichever's easier.`)}`
    : null;
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs">
      <select value={docId} onChange={(e) => setDocId(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1">
        <option value="">Select a document…</option>
        {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      {needsNda && (
        <p className="mt-1.5 text-[11px] text-amber-700">
          🔒 Due diligence only — granting it here locks access until a signed NDA is on file.
          {ndaDraftHref && <> <Link href={ndaDraftHref} className="font-medium underline">Draft an NDA request message →</Link></>}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button disabled={!docId || busy} onClick={() => onGrant(docId)} className="rounded bg-[#0E7490] px-2 py-1 font-medium text-white disabled:opacity-40">Grant access</button>
        <button onClick={onCancel} className="rounded border border-gray-300 px-2 py-1">Cancel</button>
      </div>
    </div>
  );
}

function PromiseDate({ busy, onCancel, onPromise }: { busy: boolean; onCancel: () => void; onPromise: (date: string) => void }) {
  const [date, setDate] = useState('');
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs">
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-gray-300 px-2 py-1" />
      <div className="mt-2 flex gap-2">
        <button disabled={!date || busy} onClick={() => onPromise(date)} className="rounded bg-[#0E7490] px-2 py-1 font-medium text-white disabled:opacity-40">Promise this date</button>
        <button onClick={onCancel} className="rounded border border-gray-300 px-2 py-1">Cancel</button>
      </div>
    </div>
  );
}

function DeclineReason({ busy, onCancel, onDecline }: { busy: boolean; onCancel: () => void; onDecline: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs">
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why won't you share this? The investor sees this reason."
        className="w-full rounded border border-gray-300 px-2 py-1" />
      <div className="mt-2 flex gap-2">
        <button disabled={!reason.trim() || busy} onClick={() => onDecline(reason.trim())} className="rounded bg-[#B00000] px-2 py-1 font-medium text-white disabled:opacity-40">Decline</button>
        <button onClick={onCancel} className="rounded border border-gray-300 px-2 py-1">Cancel</button>
      </div>
    </div>
  );
}

// Prompt 372 Block E — the central case, end to end: upload from the
// founder's own computer, right here, no detour to "tidy up the Vault"
// first. "Join to the Data Room" is pre-selected (Nuno's own decision);
// unchecking it sends the file as a message attachment instead and the
// screen says plainly it won't live in the Data Room.
function UploadNew({ orgId, folders, itemId, busy, onCancel, onDone, onFulfilledViaMessage }: {
  orgId: string; folders: { id: string; name: string }[]; itemId: string; busy: boolean;
  onCancel: () => void; onDone: () => void; onFulfilledViaMessage: (note: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [joinVault, setJoinVault] = useState(true);
  const [folderId, setFolderId] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [visibility, setVisibility] = useState<DocVisibility>('on_grant');
  const [ndaRequired, setNdaRequired] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!file) return;
    setError(''); setUploading(true);
    try {
      if (!joinVault) {
        // Block E §4 — sent as a message attachment, never added to the
        // Vault. The file still needs the SAME verify-upload gate before it
        // can be attached to a deal_messages row — never a second,
        // less-secure write path just because it isn't going in the Vault.
        await uploadAndVerifyFile(orgId, file);
        onFulfilledViaMessage(`Sent "${file.name}" as a message attachment — not added to the Data Room.`);
        return;
      }
      const verified = await uploadAndVerifyFile(orgId, file);
      // Folder creation happens server-side (fulfill-upload route) so a
      // brand-new folder's id is available in the SAME request that needs
      // it — the client store's createFolder() has no return value to
      // chain off synchronously.
      const res = await fetch('/api/founder/document-requests/fulfill-upload', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemId, storagePath: verified.storagePath, fileName: file.name, malwareScanStatus: verified.malwareScanStatus,
          folderId: folderId || null, newFolderName: folderId ? undefined : newFolderName, visibility, ndaRequired,
        }),
      });
      const body = await res.json();
      if (!body.ok) { setError(body.error ?? 'Could not save the document.'); return; }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally { setUploading(false); }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs">
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
      <label className="mt-2 flex items-center gap-1.5">
        <input type="checkbox" checked={joinVault} onChange={(e) => setJoinVault(e.target.checked)} /> Join to the Data Room
      </label>
      {joinVault && (
        <div className="mt-1.5 space-y-1.5">
          <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1">
            <option value="">— choose a folder —</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {!folderId && (
            <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="or create a new folder"
              className="w-full rounded border border-gray-300 px-2 py-1" />
          )}
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as DocVisibility)} className="w-full rounded border border-gray-300 px-2 py-1">
            {VISIBILITY_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={ndaRequired} onChange={(e) => setNdaRequired(e.target.checked)} /> Require an NDA for this document
          </label>
        </div>
      )}
      {!joinVault && <p className="mt-1.5 text-[11px] text-amber-700">This file will NOT be added to your Data Room — it goes out as a message attachment only.</p>}
      {error && <p className="mt-1.5 text-[11px] text-[#B00000]">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button disabled={!file || uploading || busy} onClick={submit} className="rounded bg-[#0E7490] px-2 py-1 font-medium text-white disabled:opacity-40">
          {uploading ? 'Uploading…' : 'Save'}
        </button>
        <button onClick={onCancel} className="rounded border border-gray-300 px-2 py-1">Cancel</button>
      </div>
    </div>
  );
}
