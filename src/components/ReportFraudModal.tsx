'use client';
// Prompt 277 A.2 — the serious path for HardFilterBanner's "Report —
// suspected fraud/scam" action. A real modal, not the window.confirm used
// for "Not a fit": justification + evidence are both required, and
// submission goes straight to POST /api/entities/[id]/report-fraud
// (entity_fraud_flags, migration 0196 — platform review), never a plain
// resolveHardFilter() call, so the report can't half-land (see that
// route's own header comment). Portal to document.body, same fix/
// reasoning as WelcomeModal.tsx/HelpSupportWidget.tsx — an ancestor with
// backdrop-blur/transform/etc. silently becomes the containing block for
// a plain `position:fixed` overlay otherwise (see CLAUDE.md).
import { useState } from 'react';
import { createPortal } from 'react-dom';

export function ReportFraudModal({ entityId, entityName, onReported, onCancel }: {
  entityId: string; entityName: string; onReported: () => void; onCancel: () => void;
}) {
  const [justification, setJustification] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!justification.trim() || !evidence.trim()) { setErr('Justification and evidence are both required.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/entities/${entityId}/report-fraud`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ justification: justification.trim(), evidence: evidence.trim() }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Something went wrong.'); return; }
      onReported();
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="report-fraud-title"
        className="w-full max-w-[520px] rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id="report-fraud-title" className="text-lg font-semibold text-gray-900">🚨 Report — suspected fraud/scam</h2>
        <p className="mt-1 text-sm text-gray-500">
          This is a serious step, not a quick dismissal — <span className="font-medium text-gray-700">{entityName}</span> moves
          to a pending-review state until a platform admin looks at it. Reporting it doesn&apos;t confirm anything by itself.
        </p>
        <label className="mt-4 block text-xs font-medium text-gray-600">
          Justification — why do you think this is fraud or a scam?
          <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3}
            placeholder="What made you suspicious?" disabled={busy}
            className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm disabled:opacity-60" />
        </label>
        <label className="mt-3 block text-xs font-medium text-gray-600">
          Evidence — a link, a note, a screenshot URL
          <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={2}
            placeholder="e.g. a link to the fake page, a copy of the message they sent" disabled={busy}
            className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm disabled:opacity-60" />
        </label>
        {err && <p className="mt-2 text-sm text-[#B00000]">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">
            Cancel
          </button>
          <button onClick={() => void submit()} disabled={busy || !justification.trim() || !evidence.trim()}
            className="rounded-lg bg-[#B00000] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#8f0000] disabled:opacity-40">
            {busy ? 'Submitting…' : 'Submit report'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
