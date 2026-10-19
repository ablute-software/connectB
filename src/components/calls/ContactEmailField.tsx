'use client';
// Prompt 907 (I5) — "Contact email for applicants" in the General tab (spec §23): optional. When set, the emails of THIS call (the receipt, the
// reminder, the new deadline) carry it as their Reply-To; when empty they have none and the footer says replies are not read. Saved on its own, at any
// time (also once the call is open): it is not part of what applicants answer.
import { useState } from 'react';
import { parseContactEmail } from '@/lib/calls/applicant/contact';

export function ContactEmailField({ callId, initial, canConfigure }: { callId: string; initial: string | null; canConfigure: boolean }) {
  const [value, setValue] = useState(initial ?? '');
  const [saved, setSaved] = useState(initial ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const parsed = parseContactEmail(value);

  async function save() {
    if (!parsed.ok) { setState('error'); setError(parsed.error); return; }
    if ((parsed.email ?? '') === saved) return;
    setState('saving'); setError('');
    try {
      const r = await fetch(`/api/calls/${callId}/contact`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contactEmail: parsed.email }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) { setState('error'); setError(d.error ?? 'We could not save it.'); return; }
      setSaved(d.contactEmail ?? ''); setValue(d.contactEmail ?? ''); setState('saved');
    } catch { setState('error'); setError('We could not reach the server. Check your connection and try again.'); }
  }

  return (
    <section className="mt-6" data-testid="contact-email-field">
      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500" htmlFor="contact-email">Contact email for applicants <span className="font-normal normal-case text-gray-400">(optional)</span></label>
      <input id="contact-email" type="email" autoComplete="off" className="mt-1 block w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
        value={value} disabled={!canConfigure} placeholder="applications@your-organisation.com" onChange={(e) => { setValue(e.target.value); setState('idle'); }} onBlur={() => void save()} />
      <p className="mt-1 text-[11px] text-gray-500">
        Replies to the emails of this call (application received, reminders, new deadline) go here. If you leave it empty, those emails have no reply address and say that replies are not read.
        {state === 'saving' && <span className="ml-2">Saving…</span>}
        {state === 'saved' && <span className="ml-2 text-emerald-700">Saved</span>}
      </p>
      {error && <p role="alert" className="mt-1 text-xs text-[#B00000]">{error}</p>}
    </section>
  );
}
