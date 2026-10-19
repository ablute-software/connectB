'use client';
// Prompt 326 — badges/awards, discreet in the workspace (a "+ Add" affordance on the right of the Card, same convention as
// StartupTeamCard.tsx/TractionCard.tsx — no heavy modal always open).
//
// Prompt 918 C — rewritten around ONE rule: an investor sees a badge only after Sherlock confirmed it against a public source. So each
// badge says, in words, what an investor sees of it ("Private — not shown to investors until verified" / "Private — contradicted by
// public sources: …" / "Visible to investors · verified 14 Oct 2026 · source: altice.pt"), the form takes the link to the page that
// proves it (Sherlock reads THAT link), and the logo is the founder's upload > the one verification found > the icon for the kind —
// never initials. A verification costs credits, so it asks first and says what it costs (the wallet's own numbers).
//
// BadgesCardView is the presentational half (no fetching, no state): the three states are tested and photographed from it.
import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui';
import { useConfirm } from '@/lib/confirm';
import { createPortal } from 'react-dom';
import { authEnabled, browserClient } from '@/lib/supabase';
import { uploadAndVerifyFile } from '@/lib/vault-upload-client';
import { simpleSpendDialog } from '@/lib/ai-spend-confirm';
import { fetchWalletStatus } from '@/lib/ai-spend-confirm-client';
import {
  BADGES_FOUNDER_INTRO, BADGE_KINDS, BADGE_KIND_LABEL, badgeHasLogo, badgeStatusLine, founderBadgeLogoPath, formatBadgeDate,
  parseBadgeKind, type BadgeKind, type BadgeStatusTone, type CompanyBadge,
} from '@/lib/company-badges';
import { BadgeLogo } from './BadgeLogo';

interface DocOption { id: string; name: string }

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

const TONE_CLASS: Record<BadgeStatusTone, string> = {
  private: 'text-gray-500',
  contradicted: 'text-amber-700',
  visible: 'text-emerald-700',
};

function logoSrc(b: CompanyBadge): string | null {
  if (!badgeHasLogo({ logoStoragePath: b.logo_storage_path, logoUrl: b.logo_url })) return null;
  return `${founderBadgeLogoPath(b.id)}${b.updated_at ? `?v=${encodeURIComponent(b.updated_at)}` : ''}`;
}

function verifyLabel(b: CompanyBadge): string {
  return b.verification_status === 'disputed' || b.verification_note ? 'Re-verify' : 'Verify';
}

export interface BadgesCardViewProps {
  badges: CompanyBadge[] | null;
  canEdit: boolean;
  /** The badge being verified right now (its button says so; every other verify button waits). */
  busyId: string | null;
  notice?: string;
  error?: string;
  onAdd?: () => void;
  onEdit?: (b: CompanyBadge) => void;
  onVerify?: (b: CompanyBadge) => void;
}

export function BadgesCardView({ badges, canEdit, busyId, notice, error, onAdd, onEdit, onVerify }: BadgesCardViewProps) {
  if (!canEdit && (!badges || badges.length === 0)) return null;
  return (
    <Card title="Badges & awards" right={canEdit ? <button type="button" onClick={onAdd} className="text-xs text-cyan-700 hover:underline">+ Add</button> : undefined}>
      <p className="max-w-prose text-xs text-gray-500">{BADGES_FOUNDER_INTRO}</p>
      {notice && <p className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800" role="status">{notice}</p>}
      {error && <p className="mt-2 text-xs font-medium text-[#B00000]" role="alert">{error}</p>}
      {!badges || badges.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">No badges yet — accelerator programs, awards, or certifications you can point to.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100">
          {badges.map((b) => {
            const line = badgeStatusLine(b, formatBadgeDate);
            const showNote = b.verification_status === 'unverified' && !!b.verification_note?.trim();
            return (
              <li key={b.id} className="flex items-start gap-3 py-2.5" data-badge-state={b.verification_status}>
                <BadgeLogo src={logoSrc(b)} kind={b.kind} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {b.name}{b.year ? <span className="font-normal text-gray-500"> · {b.year}</span> : null}
                    <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 align-middle text-[10px] font-medium text-gray-500">{BADGE_KIND_LABEL[b.kind]}</span>
                  </p>
                  <p className={`mt-0.5 text-xs ${TONE_CLASS[line.tone]}`}>{line.text}</p>
                  {showNote && <p className="mt-0.5 line-clamp-3 text-[11px] text-gray-400">{b.verification_note}</p>}
                  {b.source_url && line.tone !== 'visible' && (
                    <a href={b.source_url} target="_blank" rel="noopener nofollow" className="mt-0.5 block truncate text-[11px] text-gray-400 underline decoration-gray-300 underline-offset-2">
                      Your source link: {b.source_url}
                    </a>
                  )}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {b.verification_status !== 'verified' && (
                      <button type="button" onClick={() => onVerify?.(b)} disabled={busyId !== null}
                        className="rounded-full border border-emerald-300 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50">
                        {busyId === b.id ? 'Checking…' : verifyLabel(b)}
                      </button>
                    )}
                    <button type="button" onClick={() => onEdit?.(b)} className="text-[11px] text-cyan-700 hover:underline">Edit</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const EMPTY_DRAFT = { name: '', description: '', year: '', kind: 'award' as BadgeKind, sourceUrl: '', evidenceDocumentId: '' };

export function BadgesCard({ canEdit, orgId }: { canEdit: boolean; orgId: string }) {
  const confirm = useConfirm();
  const [badges, setBadges] = useState<CompanyBadge[] | null>(null);
  const [docs, setDocs] = useState<DocOption[]>([]);
  const [open, setOpen] = useState<CompanyBadge | 'new' | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<{ id: string; statement: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingLogoPath, setPendingLogoPath] = useState<string | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);

  function load() {
    if (!authEnabled) { setBadges([]); return; }
    fetch('/api/company-badges').then((r) => r.json()).then((b) => setBadges(b.ok ? b.badges : [])).catch(() => setBadges([]));
    browserClient().from('documents').select('id, name').eq('org_id', orgId).then(({ data }) => setDocs(data ?? []));
  }
  useEffect(load, [orgId]);

  function openNew() {
    setDraft(EMPTY_DRAFT);
    setPendingLogoPath(null); setLogoRemoved(false); setDuplicateOf(null); setError(''); setNotice('');
    setOpen('new');
  }
  function openEdit(b: CompanyBadge) {
    setDraft({
      name: b.name, description: b.description ?? '', year: b.year ? String(b.year) : '', kind: parseBadgeKind(b.kind),
      sourceUrl: b.source_url ?? '', evidenceDocumentId: b.evidence_document_id ?? '',
    });
    setPendingLogoPath(b.logo_storage_path); setLogoRemoved(false); setDuplicateOf(null); setError(''); setNotice('');
    setOpen(b);
  }

  async function uploadLogo(file: File) {
    if (file.size > MAX_LOGO_BYTES) { setError('Logo must be under 2MB.'); return; }
    if (!LOGO_ACCEPT.split(',').includes(file.type)) { setError('Logo must be a PNG, JPG, WebP or GIF image.'); return; }
    setUploading(true); setError('');
    try {
      const verified = await uploadAndVerifyFile(orgId, file);
      setPendingLogoPath(verified.storagePath); setLogoRemoved(false);
    } catch (e) { setError((e as Error).message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  function yearProblem(): string | null {
    if (!draft.year) return null;
    const y = Number(draft.year);
    return y >= 1900 && y <= 2100 ? null : 'Year must be between 1900 and 2100.';
  }

  // linkedClaimId: a real claim id ("Yes, link"), or the literal string
  // 'skip' — server-side dedup only runs when linkedClaimId is omitted
  // entirely, so "skip" is sent as an explicit no-op value distinct from
  // "haven't decided yet" (which is the normal first-attempt POST).
  function createBadge(linkedClaimId: string | 'skip' | null) {
    const problem = yearProblem();
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    const payload = {
      name: draft.name.trim(), description: draft.description.trim() || undefined,
      year: draft.year ? Number(draft.year) : undefined, kind: draft.kind,
      sourceUrl: draft.sourceUrl.trim() || undefined, logoStoragePath: pendingLogoPath ?? undefined,
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
    const problem = yearProblem();
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    // What the form shows is what is saved, so clearing a field clears it (null), and an unchanged link is sent back as it was
    // (the server only treats a DIFFERENT name, year or link as an edit that sends a verified badge back to private).
    const payload = {
      name: draft.name.trim(), description: draft.description.trim() || null,
      year: draft.year ? Number(draft.year) : null, kind: draft.kind,
      sourceUrl: draft.sourceUrl.trim() || null,
      logoStoragePath: logoRemoved ? null : (pendingLogoPath ?? undefined),
      evidenceDocumentId: draft.evidenceDocumentId || null,
    };
    fetch(`/api/company-badges/${open.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then((r) => r.json()).then((b) => {
        if (!b.ok) { setError(b.error); return; }
        setOpen(null); load();
        if (b.resetsVerification) setNotice('Saved — this badge is private again until Sherlock verifies it again.');
      }).finally(() => setBusy(false));
  }

  async function remove(id: string) {
    if (!(await confirm({ message: 'Delete this badge? This can’t be undone.', destructive: true }))) return;
    setBusy(true);
    fetch(`/api/company-badges/${id}`, { method: 'DELETE' }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setError(b.error); return; }
      setOpen(null); load();
    }).finally(() => setBusy(false));
  }

  // A verification reads a page, may search the web and calls the model: it costs credits (the wallet charges BEFORE the model runs, and
  // answers 402 when it cannot cover it). So it asks first and says what it costs — the same dialog every other metered action uses.
  async function verify(b: CompanyBadge) {
    setError(''); setNotice('');
    const wallet = await fetchWalletStatus('badge_verification');
    if (!(await confirm(simpleSpendDialog({ actionLabel: 'Badge verification', wallet })))) return;
    setVerifyingId(b.id);
    try {
      const res = await fetch(`/api/company-badges/${b.id}/verify`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!body.ok) { setError(body.error ?? 'Verification failed. Nothing was changed.'); return; }
      if (body.configured === false) { setError(body.message); return; }
      load();
      setOpen(null);
      if (body.status === 'verified') setNotice(`“${b.name}” is verified — investors can now see it, with the source.`);
      else if (body.status === 'disputed') setNotice(`Public sources contradict “${b.name}” — it stays private. ${body.note ?? ''}`.trim());
      else setNotice(`“${b.name}” is not verified yet, so it stays private. ${body.note ?? ''}`.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVerifyingId(null);
    }
  }

  return (
    <>
      <BadgesCardView badges={badges} canEdit={canEdit} busyId={verifyingId} notice={notice} error={open ? '' : error}
        onAdd={openNew} onEdit={openEdit} onVerify={(b) => { void verify(b); }} />

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
              <input autoComplete="off" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Name (e.g. YCombinator W23)" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
              <div className="flex gap-2">
                <select value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: parseBadgeKind(e.target.value) }))} aria-label="Type"
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white p-2 text-sm">
                  {BADGE_KINDS.map((k) => <option key={k} value={k}>{BADGE_KIND_LABEL[k]}</option>)}
                </select>
                <input autoComplete="off" inputMode="numeric" value={draft.year} onChange={(e) => setDraft((d) => ({ ...d, year: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  placeholder="Year" aria-label="Year" className="w-24 rounded-lg border border-gray-300 p-2 text-sm" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-600" htmlFor="badge-source-link">Source link</label>
                <input id="badge-source-link" autoComplete="off" inputMode="url" value={draft.sourceUrl} onChange={(e) => setDraft((d) => ({ ...d, sourceUrl: e.target.value }))}
                  placeholder="https://…" className="mt-0.5 w-full rounded-lg border border-gray-300 p-2 text-sm" />
                <p className="mt-0.5 text-[11px] text-gray-500">Page of the award, the event, or a public news piece — Sherlock verifies this link</p>
              </div>
              <textarea autoComplete="off" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                rows={2} placeholder="Short description (optional — private, not shown to investors)" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
              <div>
                <label className="text-[11px] text-gray-500">Logo (optional, PNG, JPG, WebP or GIF, max 2MB)</label>
                <input ref={fileRef} type="file" accept={LOGO_ACCEPT} disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }} className="mt-0.5 block text-xs" />
                {uploading && <p className="text-[11px] text-gray-400">Uploading…</p>}
                {pendingLogoPath && !logoRemoved && !uploading && (
                  <p className="text-[11px] text-gray-500">
                    Logo attached.{' '}
                    <button type="button" onClick={() => setLogoRemoved(true)} className="text-cyan-700 hover:underline">Remove</button>
                  </p>
                )}
                {logoRemoved && <p className="text-[11px] text-gray-500">Logo will be removed when you save. If verification finds one, that is used instead.</p>}
              </div>
              <select value={draft.evidenceDocumentId} onChange={(e) => setDraft((d) => ({ ...d, evidenceDocumentId: e.target.value }))}
                aria-label="Supporting document" className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm">
                <option value="">No supporting document</option>
                {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              {open !== 'new' && (
                <div className="rounded-lg bg-gray-50 p-2 text-[11px]">
                  <p className={TONE_CLASS[badgeStatusLine(open, formatBadgeDate).tone]}>{badgeStatusLine(open, formatBadgeDate).text}</p>
                  {open.verification_status === 'unverified' && open.verification_note && <p className="mt-0.5 text-gray-400">{open.verification_note}</p>}
                  {open.verification_status !== 'unverified' && (
                    <p className="mt-0.5 text-gray-500">Changing the name, the year or the source link makes it private again until Sherlock verifies it again.</p>
                  )}
                  {open.verification_status !== 'verified' && (
                    <p className="mt-0.5 text-gray-500">Verification reads what is saved: save your changes, then press {verifyLabel(open)} on the badge.</p>
                  )}
                </div>
              )}
              {error && <p className="text-xs font-medium text-[#B00000]" role="alert">{error}</p>}
              <div className="flex flex-wrap gap-1.5">
                <button onClick={save} disabled={busy || !draft.name.trim()}
                  className="rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
                  {open === 'new' ? 'Create' : 'Save'}
                </button>
                {open !== 'new' && (
                  <button onClick={() => remove(open.id)} disabled={busy} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-[#B00000]">Delete</button>
                )}
                <button onClick={() => setOpen(null)} className="rounded-full border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Close</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
