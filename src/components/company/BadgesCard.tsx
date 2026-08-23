'use client';
// Prompt 326 — badges/awards, discreet in the workspace (a small icon grid
// + a "+ Add" affordance, same right-side Card button convention as
// StartupTeamCard.tsx/TractionCard.tsx — no heavy modal always open).
// Verified shows in color; unverified shows the same content in
// grayscale + reduced opacity, never hidden — the founder can always see
// exactly what an investor would see for each badge.
import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui';
import { createPortal } from 'react-dom';
import { authEnabled, browserClient } from '@/lib/supabase';
import { uploadAndVerifyFile } from '@/lib/vault-upload-client';

interface Badge {
  id: string; name: string; description: string | null; year: number | null;
  logo_storage_path: string | null; evidence_document_id: string | null;
  verification_status: 'unverified' | 'verified' | 'disputed'; verification_note: string | null;
}
interface DocOption { id: string; name: string }

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function BadgesCard({ canEdit, orgId }: { canEdit: boolean; orgId: string }) {
  const [badges, setBadges] = useState<Badge[] | null>(null);
  const [logoUrls, setLogoUrls] = useState<Map<string, string>>(new Map());
  const [docs, setDocs] = useState<DocOption[]>([]);
  const [open, setOpen] = useState<Badge | 'new' | null>(null);
  const [draft, setDraft] = useState({ name: '', description: '', year: '', evidenceDocumentId: '' });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [duplicateOf, setDuplicateOf] = useState<{ id: string; statement: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingLogoPath, setPendingLogoPath] = useState<string | null>(null);

  function load() {
    if (!authEnabled) { setBadges([]); return; }
    fetch('/api/company-badges').then((r) => r.json()).then((b) => setBadges(b.ok ? b.badges : [])).catch(() => setBadges([]));
    browserClient().from('documents').select('id, name').eq('org_id', orgId).then(({ data }) => setDocs(data ?? []));
  }
  useEffect(load, [orgId]);

  useEffect(() => {
    if (!authEnabled || !badges) return;
    const withLogos = badges.filter((b) => b.logo_storage_path);
    if (withLogos.length === 0) return;
    Promise.all(withLogos.map((b) =>
      browserClient().storage.from('data-room').createSignedUrl(b.logo_storage_path!, 3600).then(({ data }) => [b.id, data?.signedUrl ?? null] as const),
    )).then((pairs) => setLogoUrls(new Map(pairs.filter(([, url]) => url) as [string, string][])));
  }, [badges]);

  function openNew() {
    setDraft({ name: '', description: '', year: '', evidenceDocumentId: '' });
    setPendingLogoPath(null); setDuplicateOf(null); setError('');
    setOpen('new');
  }
  function openEdit(b: Badge) {
    setDraft({ name: b.name, description: b.description ?? '', year: b.year ? String(b.year) : '', evidenceDocumentId: b.evidence_document_id ?? '' });
    setPendingLogoPath(b.logo_storage_path); setDuplicateOf(null); setError('');
    setOpen(b);
  }

  async function uploadLogo(file: File) {
    if (file.size > MAX_LOGO_BYTES) { setError('Logo must be under 2MB.'); return; }
    setUploading(true); setError('');
    try {
      const verified = await uploadAndVerifyFile(orgId, file);
      setPendingLogoPath(verified.storagePath);
    } catch (e) { setError((e as Error).message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  // linkedClaimId: a real claim id ("Yes, link"), or the literal string
  // 'skip' — server-side dedup only runs when linkedClaimId is omitted
  // entirely, so "skip" is sent as an explicit no-op value distinct from
  // "haven't decided yet" (which is the normal first-attempt POST).
  function createBadge(linkedClaimId: string | 'skip' | null) {
    setBusy(true); setError('');
    const payload = {
      name: draft.name.trim(), description: draft.description.trim() || undefined,
      year: draft.year ? Number(draft.year) : undefined, logoStoragePath: pendingLogoPath ?? undefined,
      evidenceDocumentId: draft.evidenceDocumentId || undefined,
      linkedClaimId: linkedClaimId && linkedClaimId !== 'skip' ? linkedClaimId : undefined,
      skipDuplicateCheck: linkedClaimId === 'skip' || undefined,
    };
    fetch('/api/company-badges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then((r) => r.json()).then((b) => {
        if (!b.ok) { setError(b.error); return; }
        if (b.duplicateOf) { setDuplicateOf(b.duplicateOf); return; }
        setDuplicateOf(null); setOpen(null); load();
      }).finally(() => setBusy(false));
  }

  function save() {
    if (!draft.name.trim() || !open) return;
    if (open === 'new') { createBadge(null); return; }
    setBusy(true); setError('');
    const payload = {
      name: draft.name.trim(), description: draft.description.trim() || undefined,
      year: draft.year ? Number(draft.year) : undefined, logoStoragePath: pendingLogoPath ?? undefined,
      evidenceDocumentId: draft.evidenceDocumentId || undefined,
    };
    fetch(`/api/company-badges/${open.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then((r) => r.json()).then((b) => {
        if (!b.ok) { setError(b.error); return; }
        setOpen(null); load();
      }).finally(() => setBusy(false));
  }

  function remove(id: string) {
    if (!window.confirm('Delete this badge? This can’t be undone.')) return;
    setBusy(true);
    fetch(`/api/company-badges/${id}`, { method: 'DELETE' }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setError(b.error); return; }
      setOpen(null); load();
    }).finally(() => setBusy(false));
  }

  function verify(id: string) {
    setBusy(true); setError('');
    fetch(`/api/company-badges/${id}/verify`, { method: 'POST' }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setError(b.error); return; }
      if (b.configured === false) { setError(b.message); return; }
      load();
      if (open && open !== 'new' && open.id === id) setOpen(null);
    }).finally(() => setBusy(false));
  }

  if (!canEdit && (!badges || badges.length === 0)) return null;

  return (
    <Card title="Badges & awards" right={canEdit ? <button onClick={openNew} className="text-xs text-cyan-700 hover:underline">+ Add</button> : undefined}>
      {!badges || badges.length === 0 ? (
        <p className="text-sm text-gray-400">No badges yet — accelerator programs, awards, or certifications you can point to.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {badges.filter((b) => b.verification_status !== 'disputed' || canEdit).map((b) => (
            <button key={b.id} onClick={() => canEdit && openEdit(b)}
              title={b.verification_status === 'disputed' ? `Disputed — ${b.verification_note ?? 'see details'}` : b.verification_status === 'unverified' ? 'Not yet verified — add supporting evidence or wait for AI to confirm' : undefined}
              className="flex w-20 flex-col items-center gap-1 text-center">
              <span className={`relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border ${
                b.verification_status === 'verified' ? 'border-cyan-200 bg-cyan-50' : 'border-gray-200 bg-gray-50 opacity-60 grayscale'
              }`}>
                {logoUrls.has(b.id) ? <img src={logoUrls.get(b.id)} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px] text-gray-400">{b.name.slice(0, 2).toUpperCase()}</span>}
                {b.verification_status === 'unverified' && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-gray-400" />}
                {b.verification_status === 'disputed' && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />}
              </span>
              <span className="line-clamp-2 text-[10px] text-gray-600">{b.name}</span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <Modal onClose={() => setOpen(null)}>
          <h2 className="text-sm font-bold text-gray-800">{open === 'new' ? 'New badge' : 'Edit badge'}</h2>
          {duplicateOf ? (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              This matches an existing claim: &ldquo;{duplicateOf.statement}&rdquo; — link them?
              <div className="mt-1.5 flex gap-1.5">
                <button onClick={() => createBadge(duplicateOf!.id)} className="rounded-full bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white">Yes, link</button>
                <button onClick={() => createBadge('skip')} className="rounded-full border border-amber-400 px-2 py-1 text-[11px] text-amber-700">Skip, keep separate</button>
              </div>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Name (e.g. YCombinator W23)" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
              <textarea value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                rows={2} placeholder="Short description (optional)" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
              <input value={draft.year} onChange={(e) => setDraft((d) => ({ ...d, year: e.target.value.replace(/\D/g, '') }))}
                placeholder="Year (optional)" className="w-24 rounded-lg border border-gray-300 p-2 text-sm" />
              <div>
                <label className="text-[11px] text-gray-500">Logo (optional, max 2MB)</label>
                <input ref={fileRef} type="file" accept="image/*" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} className="mt-0.5 block text-xs" />
                {uploading && <p className="text-[11px] text-gray-400">Uploading…</p>}
              </div>
              <select value={draft.evidenceDocumentId} onChange={(e) => setDraft((d) => ({ ...d, evidenceDocumentId: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm">
                <option value="">No supporting document</option>
                {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              {open !== 'new' && (
                <p className="text-[11px] text-gray-500">
                  Status: <span className="font-medium">{open.verification_status}</span>
                  {open.verification_note && <span className="block text-gray-400">{open.verification_note}</span>}
                </p>
              )}
              {error && <p className="text-xs font-medium text-[#B00000]">{error}</p>}
              <div className="flex flex-wrap gap-1.5">
                <button onClick={save} disabled={busy || !draft.name.trim()}
                  className="rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
                  {open === 'new' ? 'Create' : 'Save'}
                </button>
                {open !== 'new' && (
                  <button onClick={() => verify(open.id)} disabled={busy}
                    className="rounded-full border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                    Verify
                  </button>
                )}
                {open !== 'new' && (
                  <button onClick={() => remove(open.id)} disabled={busy} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-[#B00000]">Delete</button>
                )}
                <button onClick={() => setOpen(null)} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Close</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </Card>
  );
}
