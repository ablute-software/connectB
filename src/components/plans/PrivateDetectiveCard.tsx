'use client';
// PLAN-02/03 — the 4th investor plan card + its "Contact the Sherlock Team"
// form, shared between the public landing (/investors) and the signed-in
// investor workspace (/plans) so the two never drift. Modal convention
// (backdrop + stopPropagation card) matches UpgradeConfirmModal.tsx /
// AddInvestorModal.tsx, the existing pattern elsewhere in the app.
import { useState } from 'react';
import { PRIVATE_DETECTIVE_PLAN } from '@/lib/plans';

const INVESTOR_TYPES = [
  'Venture capital fund', 'Angel investor', 'Family office', 'Corporate VC',
  'Accelerator / incubator', 'Public body', 'Other',
];

function PrivateDetectiveModal({ onClose }: { onClose: () => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [investorType, setInvestorType] = useState('');
  const [firmName, setFirmName] = useState('');
  const [message, setMessage] = useState('');
  const [firmWebsite, setFirmWebsite] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const canSubmit = !!firstName.trim() && !!lastName.trim()
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && !!investorType.trim() && !!firmName.trim() && !!message.trim();

  async function submit() {
    setStatus('sending'); setError('');
    try {
      const res = await fetch('/api/plan/private-detective', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName, last_name: lastName, email, investor_type: investorType,
          firm_name: firmName, message, firm_website: firmWebsite || undefined,
          linkedin: linkedin || undefined, website,
        }),
      });
      const body = await res.json();
      if (body.ok === false) { setError(body.error ?? 'Something went wrong.'); setStatus('error'); return; }
      setStatus('sent');
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-800">Contact the Sherlock Team</h2>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-700">✕</button>
        </div>

        {status === 'sent' ? (
          <p className="mt-4 text-sm text-gray-600">
            Thank you for contacting the Sherlock Team. We have received your request and will contact you using the email address provided.
          </p>
        ) : (
          <div className="mt-4 space-y-2.5">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <select value={investorType} onChange={(e) => setInvestorType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
              <option value="">Investor type</option>
              {INVESTOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={firmName} onChange={(e) => setFirmName(e.target.value)} placeholder="Investment firm or investment group name"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="Message"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input value={firmWebsite} onChange={(e) => setFirmWebsite(e.target.value)} placeholder="Firm website (optional)"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="LinkedIn (optional)"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />

            {/* Honeypot — off-screen, mirrors ContactForm.tsx. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
              <label htmlFor="pd-website">Website</label>
              <input id="pd-website" name="website" tabIndex={-1} autoComplete="off"
                value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>

            {error && <p className="text-xs text-[#B00000]">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} disabled={status === 'sending'}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                Cancel
              </button>
              <button onClick={submit} disabled={!canSubmit || status === 'sending'}
                className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
                {status === 'sending' ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PrivateDetectiveCard({ className, dataReveal }: { className?: string; dataReveal?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* dataReveal: the public /investors pricing grid drives its .rv
          fade-in (opacity:0 until revealed) off a [data-reveal] attribute
          that LandingEffects.tsx's IntersectionObserver queries once on
          mount (see that file) — without this attribute here, this card
          never gets observed, never gets data-in="true", and stays at
          opacity:0 forever while still holding its grid cell (a real
          production bug: the 4th plan card existed in the HTML but was
          permanently invisible). The signed-in workspace usage
          (InvestorPlanGrid.tsx) doesn't run LandingEffects at all, so it
          omits this and is unaffected. */}
      <div className={className} data-reveal={dataReveal || undefined}>
        <h3>{PRIVATE_DETECTIVE_PLAN.name}</h3>
        {/* Prompt 588 — tagline + bullets, same content shape as the three
            priced cards (INVESTOR_PLANS), so this reads as a plan rather
            than an afterthought now that it's actually visible (Prompt 587).
            Styled with plain inline values instead of the landing page's
            CSS-module classes (s.who / s.plan li) — this component is also
            used from the signed-in workspace's plain-Tailwind
            InvestorPlanGrid.tsx, which has neither those classes nor the
            --muted custom property they resolve against. */}
        <p style={{ fontSize: '.85rem', color: '#5b7077', margin: '4px 0 16px' }}>{PRIVATE_DETECTIVE_PLAN.tagline}</p>
        <p style={{ marginBottom: 16 }}>{PRIVATE_DETECTIVE_PLAN.description}</p>
        <ul style={{ listStyle: 'none', margin: '0 0 20px', padding: 0, flex: 1 }}>
          {PRIVATE_DETECTIVE_PLAN.bullets.map((b) => (
            <li key={b} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '.9rem', marginBottom: 10, color: '#22343a' }}>
              <span aria-hidden="true" style={{ color: '#2a7f8e', fontWeight: 700 }}>✓</span>{b}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setOpen(true)}
          className="mt-4 w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0c637b]">
          {PRIVATE_DETECTIVE_PLAN.ctaLabel}
        </button>
      </div>
      {open && <PrivateDetectiveModal onClose={() => setOpen(false)} />}
    </>
  );
}
