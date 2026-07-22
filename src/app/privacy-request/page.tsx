'use client';
// IRM_SPEC §5 — public GDPR/RGPD data-subject request form. No sign-in
// required: this is a legal right, not a product feature, so it can't
// depend on the (not yet configured) LinkedIn claim flow.
import { useState } from 'react';

export default function PrivacyRequestPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [kind, setKind] = useState<'rectify' | 'erase'>('rectify');
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function submit() {
    setStatus('sending'); setError('');
    try {
      const res = await fetch('/api/gdpr/request', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, kind, details }),
      });
      const body = await res.json();
      if (body.ok === false) { setError(body.error); setStatus('error'); return; }
      setStatus('sent');
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  if (status === 'sent') {
    return (
      <div className="mx-auto mt-24 max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center">
        <h1 className="text-lg font-semibold">Request received</h1>
        <p className="mt-2 text-sm text-gray-600">
          We've logged your {kind === 'erase' ? 'erasure' : 'rectification'} request and will act on it within 30 days, as required by GDPR/RGPD.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-gray-200 bg-white p-6">
      <h1 className="text-lg font-semibold">Data rights request (GDPR / RGPD)</h1>
      <p className="mt-1 text-sm text-gray-500">
        If your information appears in a startup's investor CRM and you'd like it corrected or removed, tell us here.
      </p>
      <div className="mt-4 space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@fund.com"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={kind === 'rectify'} onChange={() => setKind('rectify')} /> Correct my info
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={kind === 'erase'} onChange={() => setKind('erase')} /> Erase my info
          </label>
        </div>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={4}
          placeholder={kind === 'erase' ? 'Confirm which record(s) to erase, if known.' : 'What is incorrect, and what should it say instead?'}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        {error && <p className="text-xs text-[#B00000]">{error}</p>}
        <button onClick={submit} disabled={status === 'sending' || !email || !details}
          className="w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
          {status === 'sending' ? 'Sending…' : 'Submit request'}
        </button>
      </div>
    </div>
  );
}
