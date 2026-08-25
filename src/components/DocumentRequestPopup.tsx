'use client';
// Prompt 372 Block C §1 — "mesmo peso do aviso de interesse" but a real
// modal, not a corner toast: the prompt explicitly asks for
// createPortal(document.body) + the SSR guard (CLAUDE.md's overlay rule),
// so this follows WelcomeModal.tsx's structure rather than
// InvestorInterestPopup.tsx's fixed-corner one. Polls the same way
// (30s + visibilitychange) as every other founder notification popup in
// this app.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

const POLL_MS = 30_000;

interface RequestSummary { id: string; requesterName: string | null; requesterEmail: string | null; items: { id: string }[] }

export function DocumentRequestPopup() {
  const router = useRouter();
  const [items, setItems] = useState<RequestSummary[]>([]);
  const [busy, setBusy] = useState(false);

  function load() {
    fetch('/api/founder/document-requests?unseen=1', { cache: 'no-store' }).then((r) => r.json())
      .then((body) => setItems((body.requests ?? []) as RequestSummary[])).catch(() => {});
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    function onVisible() { if (document.visibilityState === 'visible') load(); }
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const current = items[0];
  if (!current || typeof document === 'undefined') return null;

  async function markSeen() {
    await fetch('/api/founder/document-requests', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: current!.id }),
    });
    setItems((prev) => prev.filter((i) => i.id !== current!.id));
  }

  async function dismiss() { setBusy(true); try { await markSeen(); } finally { setBusy(false); } }
  async function viewRequest() {
    setBusy(true);
    try { await markSeen(); router.push(`/documents/requests/${current!.id}`); } finally { setBusy(false); }
  }

  const who = current.requesterName ?? current.requesterEmail ?? 'An investor';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="document-request-popup-title"
        className="w-full max-w-[480px] rounded-2xl bg-white p-6 shadow-2xl">
        <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-800">📄 Document request</span>
        <h2 id="document-request-popup-title" className="mt-2 text-lg font-bold text-gray-900">
          {current.items.length} document{current.items.length === 1 ? '' : 's'} requested by {who}
        </h2>
        <p className="mt-1 text-sm text-gray-500">Review each item and respond — the Vault, a promised date, or a clear decline.</p>
        <div className="mt-4 flex gap-2">
          <button onClick={() => void viewRequest()} disabled={busy}
            className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b] disabled:opacity-40">
            Ver pedido
          </button>
          <button onClick={() => void dismiss()} disabled={busy}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
            Dismiss
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
