'use client';
// PLAN-02/03 — the 4th plan card + its "Contact the Sherlock Team" form,
// shared across every audience that shows it (investor pricing on
// /investors and the signed-in investor workspace's /plans; founder
// pricing on /) so none of them can drift from each other. Modal convention
// (backdrop + stopPropagation card) matches UpgradeConfirmModal.tsx /
// AddInvestorModal.tsx, the existing pattern elsewhere in the app.
//
// Prompt 690 — one form for both audiences (investor_plan_contact_requests,
// migration 0079, has no public insert policy — same shape as every other
// public lead form here); `source` is the only thing that varies per call
// site, so backoffice/plan-requests can tell them apart without a second
// table. The founder-side pitch ("accelerator, studio or fund paying for
// its portfolio companies") is close enough to the existing investor_type
// options (Accelerator / incubator, Other) that a second form would just be
// duplication — the "Investment firm..." field label reads slightly off for
// an accelerator, but nobody is blocked from writing their program's name
// into it.
import { useState } from 'react';
import { PRIVATE_DETECTIVE_PLAN } from '@/lib/plans';

const INVESTOR_TYPES = [
  'Venture capital fund', 'Angel investor', 'Family office', 'Corporate VC',
  'Accelerator / incubator', 'Public body', 'Other',
];

function PrivateDetectiveModal({ onClose, source }: { onClose: () => void; source?: string }) {
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
          linkedin: linkedin || undefined, website, source,
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

export function PrivateDetectiveCard({ className, dataReveal, variant = 'investor', source }: {
  className?: string;
  dataReveal?: boolean;
  /** Which audience's copy to show — content only, same form/table either way. */
  variant?: 'investor' | 'founder';
  /** Recorded verbatim on the contact request row, so backoffice can tell where a lead came from. */
  source?: string;
}) {
  const [open, setOpen] = useState(false);
  const plan = PRIVATE_DETECTIVE_PLAN[variant];
  return (
    <>
      {/* dataReveal: the public /investors and / pricing grids drive their
          .rv fade-in (opacity:0 until revealed) off a [data-reveal]
          attribute that LandingEffects.tsx's IntersectionObserver queries
          once on mount (see that file) — without this attribute here, this
          card never gets observed, never gets data-in="true", and stays at
          opacity:0 forever while still holding its grid cell (a real
          production bug: the 4th plan card existed in the HTML but was
          permanently invisible). The signed-in workspace usage
          (InvestorPlanGrid.tsx) doesn't run LandingEffects at all, so it
          omits this and is unaffected. */}
      <div className={className} data-reveal={dataReveal || undefined}>
        <h3>{plan.name}</h3>
        {/* Styled with plain inline values instead of the landing page's
            CSS-module classes (s.price / s.who / s.plan li) — this
            component is also used from the signed-in workspace's
            plain-Tailwind InvestorPlanGrid.tsx, which has neither those
            classes nor the --muted/--ink custom properties they resolve
            against. Values below are the same hex/sizes landing.module.css
            uses for .who/.price/.perYear, copied in rather than shared, so
            this card matches its siblings without depending on a stylesheet
            that isn't loaded in the workspace context. */}
        <p style={{ fontSize: '.85rem', color: '#5b7077', margin: '4px 0 20px' }}>{plan.tagline}</p>
        <div style={{ fontSize: '2.5rem', fontWeight: 600, color: '#0c272e' }}>Custom</div>
        <p style={{ fontSize: '.8rem', color: '#5b7077', marginBottom: 20, minHeight: '1.2em' }}>{plan.priceCaption}</p>
        <p style={{ fontSize: '.85rem', color: '#5b7077', fontWeight: 600, marginBottom: 6 }}>{plan.openingLine}</p>
        <ul style={{ listStyle: 'none', margin: '6px 0 20px', padding: 0, flex: 1 }}>
          {plan.bullets.map((b) => (
            <li key={b} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '.9rem', marginBottom: 10, color: '#22343a' }}>
              <span aria-hidden="true" style={{ color: '#2a7f8e', fontWeight: 700 }}>✓</span>{b}
            </li>
          ))}
        </ul>
        {/* Deliberately a ghost/outline button, never the filled gold/teal
            styles the priced cards' CTAs use — Prompt 690 §1: this plan
            isn't the one to push visually, it's the "talk to us" option. */}
        <button type="button" onClick={() => setOpen(true)}
          className="mt-4 w-full rounded-lg border border-[#dde8ea] bg-transparent px-3 py-2 text-sm font-semibold text-[#0c272e] hover:bg-[#f7fafa]">
          {plan.ctaLabel}
        </button>
      </div>
      {open && <PrivateDetectiveModal onClose={() => setOpen(false)} source={source} />}
    </>
  );
}
