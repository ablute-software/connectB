'use client';
// Investor Workspace Plans & billing (Prompt 74 Bloco 2). Mirrors the
// founder PlansPanel's request-only mode (no Stripe wiring for investors
// yet — "paridade de mecanismo, não sistema novo"): shows the investor's
// current MatchDeal tier, the 3 already-priced tiers from plans.ts
// (INVESTOR_PLANS — names/prices are the founder's own spec, not invented
// here), and a request button writing to matchdeal_profiles.plan_tier_requested.
import { useEffect, useState } from 'react';
import { INVESTOR_PLANS, INVESTOR_PLAN_FOOTNOTES, MATCHDEAL_TIER_TO_INVESTOR_PLAN as MATCHDEAL_TO_TIER, type InvestorPlanTier } from '@/lib/plans';
import { PrivateDetectiveCard } from '@/components/plans/PrivateDetectiveCard';

interface Profile { plan_tier?: string | null; plan_tier_requested?: string | null }

export function InvestorPlansPanel() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState<InvestorPlanTier | null>(null);
  const [err, setErr] = useState('');
  const [requestedLocal, setRequestedLocal] = useState<string | null>(null);
  // Prompt 121 §2.4 — Monthly/Annual toggle. INVESTOR_PLANS already carries
  // real annualEur/annualPerMonthEur values (two of the three flagged
  // annualPending — a placeholder pending founder confirmation, surfaced
  // below rather than presented as final).
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');

  useEffect(() => {
    fetch('/api/portal/investor-profile').then((r) => r.json())
      .then((d) => setProfile(d.linked ? d.profile : null)).catch(() => setProfile(null));
  }, []);

  if (!profile) return <p className="text-sm text-gray-400">Loading…</p>;

  const current = MATCHDEAL_TO_TIER[profile.plan_tier ?? 'tier_a'] ?? 'pro_scout';
  const pendingRaw = requestedLocal ?? profile.plan_tier_requested ?? null;
  const pending = pendingRaw ? MATCHDEAL_TO_TIER[pendingRaw] ?? null : null;

  async function requestTier(tier: InvestorPlanTier) {
    setErr(''); setBusy(tier);
    try {
      const res = await fetch('/api/portal/plan/request', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not send the request.'); return; }
      const matchdealTier = Object.entries(MATCHDEAL_TO_TIER).find(([, v]) => v === tier)?.[0] ?? null;
      setRequestedLocal(matchdealTier);
    } finally { setBusy(null); }
  }

  const currentRow = INVESTOR_PLANS.find((p) => p.tier === current)!;

  return (
    // Prompt 121 §2.4 correction — this panel's OWN root was still capped at
    // max-w-2xl (672px), independent of and undermining the shell's new
    // max-w-6xl <main>: 4 columns inside 672px squeezed each card to ~159px,
    // the same "thin, tall card" failure BUG-03 already named, just smaller.
    // Verified live (scratch route + getBoundingClientRect) before landing
    // this correction — see the commit message.
    <div className="max-w-6xl space-y-4">
      <h1 className="text-lg font-bold text-gray-900">Plans &amp; billing</h1>

      <div data-tour-id="plans-current" className="rounded-lg border border-cyan-100 bg-[#E8F4F8] p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xl font-bold text-[#0E7490]">{currentRow.name}</span>
          <span className="text-sm text-gray-500">€{currentRow.monthlyEur}/month</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {currentRow.seats} seat{currentRow.seats === 1 ? '' : 's'} · up to {currentRow.monthlyCap} qualified opportunities/mo
        </p>
        {pending && (
          <p className="mt-1.5 text-xs text-amber-700">
            Request to switch to <b>{INVESTOR_PLANS.find((p) => p.tier === pending)?.name}</b> sent — the team will take care of it. No automatic charge.
          </p>
        )}
        {err && <p className="mt-1.5 text-xs text-[#B00000]">{err}</p>}
      </div>

      {/* Prompt 121 §2.4 — Monthly/Annual toggle, one selection for the
          whole grid (not per-card): every priced tier reads the same
          `billing` state. */}
      <div data-tour-id="plans-toggle" className="flex items-center gap-1.5">
        {(['monthly', 'annual'] as const).map((b) => (
          <button key={b} onClick={() => setBilling(b)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${billing === b ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {b === 'monthly' ? 'Monthly' : 'Annual'}
          </button>
        ))}
      </div>

      {/* BUG-03 (fixed) — this grid used to inherit InvestorWorkspaceShell's
          max-w-3xl (768px) <main>, which Tailwind's viewport-based `lg:`
          breakpoint doesn't know about: 4 columns inside 768px would
          squeeze each card to ~183px. The shell now gives the Plans tab a
          wider max-w-6xl container specifically, so lg:grid-cols-4 has
          room to actually mean 4 columns; degrades to 2x2 below that, and
          1 column on mobile (4-across on a phone is illegible). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {INVESTOR_PLANS.map((p, i) => {
          const price = billing === 'monthly' ? p.monthlyEur : p.annualPerMonthEur;
          return (
            <div key={p.tier} className={`flex flex-col rounded-lg border p-4 ${p.tier === current ? 'border-[#0E7490]' : 'border-gray-200'}`}>
              <div className="text-sm font-bold text-gray-900">{p.name}</div>
              <div className="mt-0.5 text-xs text-gray-400">{p.tagline}</div>
              <div className="mt-2 text-lg font-semibold text-[#0E7490]">
                €{price}<span className="text-xs font-normal text-gray-400">/mo</span>
              </div>
              {billing === 'annual' && (
                <p className="mt-0.5 text-[10px] text-gray-400">
                  €{p.annualEur}/year{p.annualPending && ' — pending confirmation'}
                </p>
              )}
              {/* PLAN-06 — order-derived, so it can't skip a tier or repeat two headers on one card. */}
              {i > 0 && <p className="mt-2 text-xs font-semibold text-gray-700">Everything in {INVESTOR_PLANS[i - 1].name}, plus:</p>}
              <ul className="mt-2 flex-1 space-y-1 text-xs text-gray-600">
                {p.bullets.map((b) => <li key={b}>· {b}</li>)}
              </ul>
              <p className="mt-2 text-[10px] text-gray-400">{INVESTOR_PLAN_FOOTNOTES.dataRoom} {INVESTOR_PLAN_FOOTNOTES.dueDiligence}</p>
              <div className="mt-3">
                {p.tier === current ? (
                  <span className="rounded-full bg-[#E8F4F8] px-3 py-1 text-xs font-semibold text-[#0E7490]">Current plan</span>
                ) : pending === p.tier ? (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Request sent</span>
                ) : (
                  <button onClick={() => requestTier(p.tier)} disabled={busy === p.tier}
                    className="w-full rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0c637b] disabled:opacity-40">
                    {busy === p.tier ? 'Sending…' : `Request ${p.name}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {/* Private Detective has no fixed price at all (PLAN-02 — a contact
            form, not a checkout) — the toggle above has nothing to change
            on this card, which is exactly "the same value in both modes". */}
        <PrivateDetectiveCard className="flex flex-col rounded-lg border border-gray-200 p-4" />
      </div>

      <p className="text-[11px] text-gray-400">No payment processing in this version — a plan-change request is recorded and the team applies it manually.</p>
    </div>
  );
}
