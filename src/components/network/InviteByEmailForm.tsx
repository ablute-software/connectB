'use client';
// Prompt 330 / Prompt 335 §D1 — the ONE implementation of "invite someone
// you know by email," shared by Pipeline's "Partners & colleagues" panel
// and My Network's "My contacts" panel (never a second copy). Anti-
// enumeration: the response is identical whether the email belongs to an
// existing account or not — same message, same copyable link, always.
import { useState } from 'react';

export function InviteByEmailForm({ onSent }: { onSent?: () => void }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; link?: string } | null>(null);

  function submit() {
    setBusy(true); setResult(null);
    fetch('/api/network/invite-by-email', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), message: message.trim() }),
    }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setResult({ ok: false, text: b.error ?? 'Could not send the invite.' }); return; }
      setResult({ ok: true, text: b.message, link: b.inviteLink });
      onSent?.();
    }).finally(() => setBusy(false));
  }

  function copyLink(link: string) {
    navigator.clipboard?.writeText(link).catch(() => {});
  }

  return (
    <div className="space-y-1.5">
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
        placeholder="Their email on Sherlock Deal" className="w-full rounded-lg border border-gray-300 p-1.5 text-xs" />
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2}
        placeholder="How do you know them? (required — they'll see this)"
        className="w-full rounded-lg border border-gray-300 p-1.5 text-xs" />
      {result && (
        <div className={`text-[11px] ${result.ok ? 'text-emerald-700' : 'text-gray-500'}`}>
          <p>{result.text}</p>
          {result.link && (
            <div className="mt-1 flex items-center gap-1.5">
              <input readOnly value={result.link} className="min-w-0 flex-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-1 text-[10px] text-gray-500" />
              <button onClick={() => copyLink(result.link!)} className="shrink-0 rounded-full border border-gray-300 px-2 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50">Copy</button>
            </div>
          )}
        </div>
      )}
      <button onClick={submit} disabled={busy || !email.trim() || !message.trim()}
        className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
        Send invite
      </button>
    </div>
  );
}
