'use client';
// Contact & Support — the one form behind all three entry points (/contact,
// founder "Help & support", investor portal "Help & support"). No email
// address is ever shown — this form (and /api/support/submit) is the only
// channel.
import { useState } from 'react';

export type SupportSource = 'landing' | 'landing_investors' | 'founder_app' | 'investor_portal';

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'question', label: 'Question' },
  { value: 'problem', label: 'Problem / bug' },
  { value: 'billing', label: 'Billing' },
  { value: 'data_correction', label: 'Data correction' },
  { value: 'claim_profile', label: 'Claim my investor profile' },
  { value: 'other', label: 'Other' },
];

export function ContactForm({ source, defaultName = '', defaultEmail = '', showContext = false, onDone }: {
  source: SupportSource; defaultName?: string; defaultEmail?: string; showContext?: boolean; onDone?: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [category, setCategory] = useState('question');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [context, setContext] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — real visitors never see this
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const canSubmit = !!name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && !!subject.trim() && message.trim().length >= 10 && message.length <= 5000;

  async function submit() {
    setStatus('sending'); setError('');
    try {
      const res = await fetch('/api/support/submit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name, email, category, subject, message, source,
          context: showContext && context.trim() ? context.trim() : undefined,
          website,
        }),
      });
      const body = await res.json();
      if (body.ok === false) { setError(body.error ?? 'Something went wrong.'); setStatus('error'); return; }
      setStatus('sent');
      onDone?.();
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  if (status === 'sent') {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
        <h2 className="text-base font-semibold text-gray-900">Thanks — we&apos;ll get back to you.</h2>
        <p className="mt-1 text-sm text-gray-500">We usually reply within a couple of business days.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      <select value={category} onChange={(e) => setCategory(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
        {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" maxLength={200}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={5000}
        placeholder="How can we help?"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      {showContext && (
        <input value={context} onChange={(e) => setContext(e.target.value)} placeholder="What screen were you on? (optional)"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      )}

      {/* Honeypot — off-screen, not display:none (some bots skip hidden
          inputs but still autofill visually-hidden ones), tabIndex -1 so a
          keyboard/screen-reader user never lands on it. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
        <label htmlFor="cf-website">Website</label>
        <input id="cf-website" name="website" tabIndex={-1} autoComplete="off"
          value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      {error && <p className="text-xs text-[#B00000]">{error}</p>}
      <button onClick={submit} disabled={!canSubmit || status === 'sending'}
        className="w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
        {status === 'sending' ? 'Sending…' : 'Send message'}
      </button>
    </div>
  );
}
