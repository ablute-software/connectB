'use client';
// Prompt 438 §C — the evidence popup: everything the rail used to show
// inline (suggestions, manual notes, "+ Add note") now lives here, behind
// the rail's single link. Portal to document.body per CLAUDE.md's own
// root rule on full-viewport overlays — copied from
// BarsQuestionnaireDrawer.tsx's exact pattern (SSR guard, overlay
// onClick closes, inner panel stopPropagation), styled as a centered
// modal (a short-ish list, not a form needing real vertical room),
// matching HelpSupportWidget.tsx's own centered-modal shape.
//
// Honesty is the whole point of this component, in two distinct ways:
// (1) it never claims to have searched "all documents" — only what
// /api/portal/access, company-claims, the dossier and the interaction log
// ALREADY show this investor elsewhere (bars-evidence.ts's own candidate
// list, unchanged by this file); (2) a document's "where in the document"
// locator is ALWAYS hand-typed by the investor, never generated, inferred
// or estimated — the platform has no capability to know what page a BARS
// answer's evidence sits on (see Prompt 438's own header note on
// document_extractions, which is founder-only and unrelated to this).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EvidenceCandidate } from '@/lib/bars-evidence';
import type { BarsEvidenceRef } from '@/lib/bars-scoring';
import type { EvidenceKind } from '@/lib/bars-types';

const TIER_ORDER = ['Document', 'Verified fact', 'Founder-declared', 'Your note'] as const;

function fallbackTier(kind: EvidenceKind): string {
  if (kind === 'document') return 'Document';
  if (kind === 'investor_note' || kind === 'interaction') return 'Your note';
  return 'Founder-declared';
}

function sameRef(a: BarsEvidenceRef, b: BarsEvidenceRef): boolean {
  return a.kind === b.kind && (a.id ?? a.text) === (b.id ?? b.text);
}

// A previously-attached ref may point at a candidate no longer in the
// current (hint-filtered) list — e.g. access changed since it was
// attached. Falls back to what the ref itself carried at attach time
// rather than dropping the row.
function resolveDisplay(ref: BarsEvidenceRef, candidates: EvidenceCandidate[]): { text: string; tierLabel: string } {
  const match = candidates.find((c) => c.kind === ref.kind && c.id === ref.id);
  if (match) return { text: match.text, tierLabel: match.tierLabel };
  return { text: ref.text ?? '(no longer available)', tierLabel: fallbackTier(ref.kind) };
}

// Prompt 423 §A / 438 §C.4 — same /api/portal/document-requests endpoint
// every other document ask goes through (RequestCapTableButton's own
// pattern), just without itemType: a free-text label, not a fixed
// cap-table ask.
function RequestMissingDocumentsButton({ orgId }: { orgId: string }) {
  const [label, setLabel] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'already' | 'error'>('idle');

  async function request() {
    setState('busy');
    try {
      const res = await fetch('/api/portal/document-requests', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, items: [{ label: label.trim() || 'Documents not yet shared' }] }),
      });
      const body = await res.json();
      if (!body.ok) { setState('error'); return; }
      setState(body.created ? 'sent' : 'already');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') return <p className="mt-1.5 text-xs font-medium text-green-700">✓ Requested — the founder has been notified.</p>;
  if (state === 'already') return <p className="mt-1.5 text-xs text-gray-500">Already requested — waiting on the founder.</p>;
  return (
    <div className="mt-1.5">
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What are you looking for? (e.g. market sizing methodology)"
        className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
      <button onClick={() => void request()} disabled={state === 'busy'}
        className="mt-1.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
        {state === 'busy' ? 'Requesting…' : 'Request access to documents →'}
      </button>
      {state === 'error' && <p className="mt-1 text-[11px] text-[#B00000]">Couldn&apos;t send the request — try again.</p>}
    </div>
  );
}

// Only meaningful for kind==='document' — for a claim, metric or note the
// item's own text already IS the evidence; there's no "where" to ask for.
function LocatorEditor({ evidenceRef, editing, onStartEdit, onSave, onCancel }: {
  evidenceRef: BarsEvidenceRef; editing: boolean;
  onStartEdit: () => void; onSave: (locator: string) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(evidenceRef.locator ?? '');
  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSave(draft); if (e.key === 'Escape') onCancel(); }}
          placeholder="e.g. p. 12, slide 7, §3.2" className="w-40 rounded border border-gray-300 px-1.5 py-0.5 text-[11px]" />
        <button type="button" onClick={() => onSave(draft)} className="text-[11px] font-medium text-[#0E7490] hover:underline">Save</button>
        <button type="button" onClick={onCancel} className="text-[11px] text-gray-400 hover:underline">Cancel</button>
      </span>
    );
  }
  if (evidenceRef.locator) {
    return (
      <span className="text-[11px] text-gray-500">
        — {evidenceRef.locator} <button type="button" onClick={onStartEdit} title="Edit location" className="text-gray-400 hover:text-[#0E7490]">✎</button>
      </span>
    );
  }
  return (
    <button type="button" onClick={onStartEdit} className="text-[11px] text-gray-400 hover:text-[#0E7490] hover:underline">
      + where in the document?
    </button>
  );
}

export function EvidenceAccessDialog({ orgId, title, candidates, attached, onChange, onClose }: {
  orgId: string;
  title: string;
  candidates: EvidenceCandidate[];
  attached: BarsEvidenceRef[];
  onChange: (refs: BarsEvidenceRef[]) => void;
  onClose: () => void;
}) {
  // Prompt 438 §D — a signed URL is only good for 5 minutes
  // (createSignedUrl(..., 300) in /api/portal/access); the candidates this
  // dialog was opened with may carry one minted at page-load, long dead by
  // the time the investor actually opens this popup. Re-fetches fresh ones
  // on open rather than trusting candidate.url. null = still loading (Open
  // links show a disabled "…", never a link that fails silently).
  const [freshDocUrls, setFreshDocUrls] = useState<Map<string, string | null> | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFreshDocUrls(null);
    fetch(`/api/portal/access?orgId=${encodeURIComponent(orgId)}`).then((r) => (r.ok ? r.json() : null))
      .then((body: { documents?: { id: string; url: string | null }[] } | null) => {
        if (cancelled) return;
        const map = new Map<string, string | null>();
        for (const doc of body?.documents ?? []) map.set(doc.id, doc.url ?? null);
        setFreshDocUrls(map);
      }).catch(() => { if (!cancelled) setFreshDocUrls(new Map()); });
    return () => { cancelled = true; };
  }, [orgId]);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [addingNote, setAddingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');

  if (typeof document === 'undefined') return null;

  function refKey(ref: BarsEvidenceRef): string {
    return `${ref.kind}:${ref.id ?? ref.text}`;
  }

  function detach(ref: BarsEvidenceRef) {
    onChange(attached.filter((r) => !sameRef(r, ref)));
  }
  function saveLocator(ref: BarsEvidenceRef, locator: string) {
    const trimmed = locator.trim();
    onChange(attached.map((r) => (sameRef(r, ref) ? { ...r, locator: trimmed || undefined } : r)));
    setEditingKey(null);
  }
  function attachCandidate(c: EvidenceCandidate) {
    onChange([...attached, { kind: c.kind, id: c.id, text: c.text }]);
  }
  function submitNote() {
    const text = noteDraft.trim();
    if (!text) return;
    onChange([...attached, { kind: 'investor_note', text }]);
    setNoteDraft('');
    setAddingNote(false);
  }

  function openLink(kind: EvidenceKind, id: string | undefined) {
    if (kind !== 'document' || !id) return null;
    if (freshDocUrls === null) return <span className="shrink-0 text-xs text-gray-300">…</span>;
    const url = freshDocUrls.get(id) ?? null;
    return url
      ? <a href={url} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-medium text-[#0E7490] hover:underline">Open ↗</a>
      : <span className="shrink-0 text-xs text-gray-300">—</span>;
  }

  const notAttached = candidates.filter((c) => !attached.some((a) => a.kind === c.kind && a.id === c.id));
  const groups = TIER_ORDER
    .map((tier) => ({ tier, items: notAttached.filter((c) => c.tierLabel === tier) }))
    .filter((g) => g.items.length > 0);

  // React bubbles a portal's synthetic events through the REACT tree, not
  // the DOM tree — this dialog is a React descendant of
  // BarsQuestionnaireDrawer's own portalled overlay even though both
  // render into document.body as DOM siblings, so a bare onClick={onClose}
  // here would also reach the drawer's own overlay onClose and close both
  // at once. stopPropagation keeps the two independent.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Sherlock only searched what this startup has already shared with you — {candidates.length} item{candidates.length === 1 ? '' : 's'}.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-700">✕</button>
        </div>

        <div className="mt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Evidence you attached</div>
          {attached.length === 0 ? (
            <p className="mt-1 text-xs text-gray-400">Nothing attached to this answer yet.</p>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {attached.map((ref) => {
                const { text, tierLabel } = resolveDisplay(ref, candidates);
                const key = refKey(ref);
                return (
                  <li key={key} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <span className="text-gray-700"><span className="font-medium">{tierLabel}</span> · {text}</span>
                      {ref.kind === 'document' && (
                        <div className="mt-0.5">
                          <LocatorEditor evidenceRef={ref} editing={editingKey === key}
                            onStartEdit={() => setEditingKey(key)}
                            onSave={(locator) => saveLocator(ref, locator)}
                            onCancel={() => setEditingKey(null)} />
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {openLink(ref.kind, ref.id)}
                      <button type="button" onClick={() => detach(ref)} title="Remove" className="text-gray-400 hover:text-[#B00000]">✕</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">All documents shared with you</div>
          <div className="mt-1 max-h-[50vh] space-y-2.5 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="text-xs text-gray-400">Nothing else matched yet.</p>
            ) : groups.map((g) => (
              <div key={g.tier}>
                <div className="text-[10px] font-medium text-gray-400">{g.tier} ({g.items.length})</div>
                <ul className="mt-0.5 space-y-1">
                  {g.items.map((c) => (
                    <li key={`${c.kind}-${c.id}`} className="flex items-center gap-2 text-sm">
                      <button type="button" onClick={() => attachCandidate(c)} title="Attach as evidence"
                        className="shrink-0 rounded-full border border-gray-300 px-1.5 text-xs text-gray-500 hover:border-[#0E7490] hover:text-[#0E7490]">
                        +
                      </button>
                      <span className="min-w-0 flex-1 text-gray-700">{c.text}</span>
                      {openLink(c.kind, c.id)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {addingNote ? (
              <div className="flex items-center gap-1">
                <input autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitNote(); if (e.key === 'Escape') setAddingNote(false); }}
                  placeholder="Your note…" className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-[11px]" />
                <button type="button" onClick={submitNote} className="text-[11px] font-medium text-[#0E7490] hover:underline">Add</button>
                <button type="button" onClick={() => { setAddingNote(false); setNoteDraft(''); }} className="text-[11px] text-gray-400 hover:underline">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => setAddingNote(true)}
                className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] text-gray-400 hover:border-gray-400 hover:text-gray-600">
                + Add note
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-xs text-gray-500">
            <span className="font-medium text-gray-700">Not finding what you need?</span> Documents that carry this information may exist in
            this startup&apos;s data room without being shared with you yet. Sherlock never searches what you haven&apos;t been granted.
          </p>
          <RequestMissingDocumentsButton orgId={orgId} />
          <p className="mt-2 text-[11px] text-gray-400">You can also ask for a meeting, or offer to sign an NDA, through Messages.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
