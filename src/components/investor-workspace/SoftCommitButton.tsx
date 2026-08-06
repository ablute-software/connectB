'use client';
// Investor Workspace Fase 3 (prompt 56), Bloco 3 — a concrete, explicitly
// non-binding amount. One submission is enough for v1 (no edit/withdraw —
// a genuine change is a new conversation with the founder, not a form
// resubmit).
import { useState } from 'react';

export function SoftCommitButton({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    const n = Number(amount);
    if (!n || n <= 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/portal/soft-commit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, amount_eur: n }),
      });
      const body = await res.json();
      if (body.ok) { setDone(true); setOpen(false); }
    } finally { setSaving(false); }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-[#0E7490]/30 bg-[#E8F4F8] p-3 text-sm text-[#0E7490]">
        Soft commit recorded — the founder has been notified.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Mark firm interest</h2>
      <p className="mt-1 text-xs text-gray-400">A concrete amount you&apos;re considering — this is not a binding commitment, just a clear signal to the founder.</p>
      {open ? (
        <div className="mt-2 flex gap-2">
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount in EUR"
            className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
          <button onClick={submit} disabled={saving || !amount} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            {saving ? 'Sending…' : 'Confirm'}
          </button>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="mt-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
          Mark firm interest
        </button>
      )}
    </div>
  );
}
