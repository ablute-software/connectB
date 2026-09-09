'use client';
// IRM_SPEC §5 / Prompt 616 §B.3 / Prompt 626 §D — public data-rights form. No
// sign-in required: this is a legal right, not a product feature, so it cannot
// depend on the (not yet configured) LinkedIn claim flow.
//
// WHAT CHANGED IN 626, and why each thing was wrong before:
//
// - TWO RIGHTS OF FOUR. The form offered "correct" and "erase". Access
//   (Article 15) and objection (Article 21) simply had no door, while the
//   public notice we were about to publish promises all four. Objection is the
//   one that matters most for a catalogue built on legitimate interests: it is
//   unconditional, so its option says so, and it is the only kind that does
//   not require the person to explain themselves.
//
// - "WITHIN 30 DAYS" WAS NOT TRUE. The period is one calendar month, which in
//   February is 28 days. The confirmation now shows the actual date the
//   database bound us to when the row was written, rather than a number.
//
// - IT NEVER SAID WHERE THE INFORMATION MIGHT BE. The copy spoke only of "a
//   startup's investor CRM", which is one of the two populations; the other
//   is the investor catalogue, and those are exactly the people who never gave
//   us anything and therefore most need this form.
//
// And what it still deliberately does not do (626 §C): tell the person whether
// they are in our records. The screen after submitting is identical either
// way. A form that answered would be a public name search with extra steps.
import Link from 'next/link';
import { useState } from 'react';
import { BRAND_NAME } from '@/lib/brand';
import { GDPR_KINDS, GDPR_KIND_LABEL, type GdprKind } from '@/lib/gdpr';

const PROFILES: { value: string; label: string }[] = [
  { value: 'catalog_person', label: 'I work at an investment firm' },
  { value: 'product_user', label: 'I use the product, or a company that does holds my details' },
  { value: 'other', label: 'Something else / not sure' },
];

const KIND_HINT: Record<GdprKind, string> = {
  access: 'Nothing else needed — but if you know which firm you are listed under, saying so speeds up the check.',
  rectify: 'What is incorrect, and what should it say instead?',
  object: 'You do not have to give a reason. Add anything you want us to know, or leave this blank.',
  erase: 'Confirm which record(s) to delete, if you know them.',
};

export default function PrivacyRequestPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState('catalog_person');
  const [kind, setKind] = useState<GdprKind>('access');
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function submit() {
    setStatus('sending'); setError('');
    try {
      const res = await fetch('/api/gdpr/request', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, kind, details, profile }),
      });
      const body = await res.json();
      if (body.ok === false) { setError(body.error); setStatus('error'); return; }
      setDueAt(body.dueAt ?? null);
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
          We will reply to <b>{email}</b>{dueAt ? <> by <b>{new Date(dueAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</b></> : ' within one month'}.
          If the request turns out to be complex we may need up to two months more, and we will tell you before the
          date above if that happens.
        </p>
        <p className="mt-3 text-xs text-gray-500">
          We may ask you to confirm your identity first. We do not say on this screen whether we hold anything about
          you — that answer goes to your address, not to whoever filled in this form.
        </p>
      </div>
    );
  }

  const detailsRequired = kind !== 'object';

  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-gray-200 bg-white p-6">
      <h1 className="text-lg font-semibold">Data rights request (GDPR / RGPD)</h1>
      <p className="mt-1 text-sm text-gray-500">
        If your details are held by {BRAND_NAME} — in our investor catalogue, or in a startup&apos;s own investor
        CRM — you can see, correct, restrict or delete them here. No account needed.{' '}
        <Link href="/legal/privacy-notice" className="underline">What we hold, and where it came from</Link>.
      </p>
      <div className="mt-4 space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@fund.com" type="email" autoComplete="email"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />

        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">Which describes you?</p>
          <select value={profile} onChange={(e) => setProfile(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {PROFILES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">What would you like us to do?</p>
          <div className="space-y-1.5 text-sm">
            {GDPR_KINDS.map((k) => (
              <label key={k} className="flex items-start gap-2">
                <input type="radio" className="mt-1" checked={kind === k} onChange={() => setKind(k)} />
                <span>
                  {GDPR_KIND_LABEL[k]}
                  {k === 'object' && <span className="ml-1 text-xs text-gray-400">— no reason required</span>}
                </span>
              </label>
            ))}
          </div>
        </div>

        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={4}
          placeholder={KIND_HINT[kind]}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        {error && <p className="text-xs text-[#B00000]">{error}</p>}
        <button onClick={submit} disabled={status === 'sending' || !email || (detailsRequired && !details.trim())}
          className="w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
          {status === 'sending' ? 'Sending…' : 'Submit request'}
        </button>
        <p className="text-xs text-gray-400">
          We answer within one calendar month, as Article 12(3) requires. You can also complain to the CNPD.
        </p>
      </div>
    </div>
  );
}
