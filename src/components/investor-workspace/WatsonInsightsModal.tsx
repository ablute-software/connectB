'use client';
// Prompt 394 §4.2/§4.5 — Watson's results, in a full-screen modal instead of
// the cramped ~w-72 widget they used to render inside. Follows the
// CLAUDE.md overlay rule exactly (see DocPreviewModal.tsx, the referenced
// pattern): `fixed inset-0` via createPortal(document.body), SSR guard,
// never rendered inline — an ancestor with backdrop-blur/transform
// (WorkspaceHeader) would otherwise silently collapse this to its own box.
//
// Two views inside the SAME modal (§4.5): "current" shows whichever
// reading opened it (a freshly generated one, or a past one picked from
// history); "history" lists every past reading for this startup and lets
// picking one swap the "current" view's content without closing the modal.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface Insight { kind: 'reading' | 'threshold_suggestion' | 'alert_reason'; text: string }
interface Reading { id: string; insights: Insight[]; created_at: string }

const KIND_LABEL: Record<Insight['kind'], string> = { reading: 'Reading', threshold_suggestion: 'Suggestion', alert_reason: 'Alert reason' };

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function WatsonInsightsModal({ orgId, insights, readAt, onClose }: {
  orgId: string; insights: Insight[]; readAt: string | null; onClose: () => void;
}) {
  const [view, setView] = useState<'current' | 'history'>('current');
  const [current, setCurrent] = useState<{ insights: Insight[]; readAt: string | null }>({ insights, readAt });
  const [history, setHistory] = useState<Reading[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [sharedIdx, setSharedIdx] = useState<Set<number>>(new Set());
  const [sharingIdx, setSharingIdx] = useState<number | null>(null);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);

  useEffect(() => { setCurrent({ insights, readAt }); }, [insights, readAt]);

  function openHistory() {
    setView('history');
    if (history !== null) return;
    fetch(`/api/portal/watson/evaluation-support/history?orgId=${encodeURIComponent(orgId)}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setHistory(d.readings ?? []); else setHistoryError(d.error ?? 'Could not load history.'); })
      .catch(() => setHistoryError('Could not load history.'));
  }

  function openReading(r: Reading) {
    setCurrent({ insights: r.insights, readAt: r.created_at });
    setSharedIdx(new Set());
    setView('current');
  }

  async function share(idx: number) {
    const insight = current.insights[idx];
    if (!insight) return;
    setSharingIdx(idx);
    try {
      const res = await fetch('/api/portal/watson/share', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, kind: insight.kind, text: insight.text }),
      });
      const body = await res.json();
      if (body.ok) setSharedIdx((prev) => new Set(prev).add(idx));
    } finally { setSharingIdx(null); setConfirmIdx(null); }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900">Watson&apos;s opinion</p>
            {view === 'current' && (
              <button onClick={openHistory} className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50">
                History
              </button>
            )}
            {view === 'history' && (
              <button onClick={() => setView('current')} className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50">
                ← Back
              </button>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {view === 'history' ? (
            <>
              {historyError && <p className="text-xs text-red-600">{historyError}</p>}
              {history === null && !historyError && <p className="text-sm text-gray-400">Loading…</p>}
              {history !== null && history.length === 0 && <p className="text-sm text-gray-400">No past readings for this startup yet.</p>}
              {history !== null && history.length > 0 && (
                <ul className="space-y-2">
                  {history.map((r) => (
                    <li key={r.id}>
                      <button onClick={() => openReading(r)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50">
                        <span className="font-medium text-gray-900">{formatWhen(r.created_at)}</span>
                        <span className="ml-2 text-xs text-gray-400">{r.insights.length} insight{r.insights.length === 1 ? '' : 's'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              {current.readAt && <p className="mb-2 text-xs text-gray-400">Read {formatWhen(current.readAt)}</p>}
              {current.insights.length === 0 && <p className="text-sm text-gray-500">Nothing notable to point out right now.</p>}
              {current.insights.length > 0 && (
                <ul className="space-y-3">
                  {current.insights.map((ins, idx) => (
                    <li key={idx} className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-gray-500 ring-1 ring-gray-200">{KIND_LABEL[ins.kind]}</span>
                          <p className="mt-1.5 text-gray-700">{ins.text}</p>
                          <p className="mt-1.5 text-[11px] text-gray-400">AI-generated by Watson — private to you unless you share it.</p>
                        </div>
                        {sharedIdx.has(idx) ? (
                          <span className="shrink-0 text-[11px] font-medium text-emerald-600">Shared with founder</span>
                        ) : confirmIdx === idx ? (
                          <div className="shrink-0 text-right">
                            <p className="mb-1 text-[11px] text-gray-500">Share this exact text with the founder, identified as you?</p>
                            <button onClick={() => share(idx)} disabled={sharingIdx === idx}
                              className="rounded-lg bg-[#0E7490] px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">
                              {sharingIdx === idx ? 'Sharing…' : 'Confirm share'}
                            </button>
                            <button onClick={() => setConfirmIdx(null)} className="ml-1 text-[11px] text-gray-400 hover:underline">Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmIdx(idx)} className="shrink-0 text-[11px] font-medium text-[#0E7490] hover:underline">
                            Share with founder
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
