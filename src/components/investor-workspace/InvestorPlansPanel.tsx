'use client';
// Investor Workspace Plans & billing (Prompt 74 Bloco 2). Mirrors the
// founder PlansPanel's request-only mode (no Stripe wiring for investors
// yet — "paridade de mecanismo, não sistema novo"): shows the investor's
// current MatchDeal tier, the 3 already-priced tiers from plans.ts
// (INVESTOR_PLANS — names/prices are the founder's own spec, not invented
// here), and a request button writing to matchdeal_profiles.plan_tier_requested.
import { useEffect, useState } from 'react';
import { INVESTOR_PLANS, type InvestorPlanTier } from '@/lib/plans';

const MATCHDEAL_TO_TIER: Record<string, InvestorPlanTier> = {
  tier_a: 'boy_scout', tier_b: 'pro_spotter', tier_c: 'ace_sleuth',
};

interface Profile { plan_tier?: string | null; plan_tier_requested?: string | null }

export function InvestorPlansPanel() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState<InvestorPlanTier | null>(null);
  const [err, setErr] = useState('');
  const [requestedLocal, setRequestedLocal] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/portal/investor-profile').then((r) => r.json())
      .then((d) => setProfile(d.linked ? d.profile : null)).catch(() => setProfile(null));
  }, []);

  if (!profile) return <p className="text-sm text-gray-400">Loading…</p>;

  const current = MATCHDEAL_TO_TIER[profile.plan_tier ?? 'tier_a'] ?? 'boy_scout';
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
    <div className="max-w-2xl space-y-4">
      <h1 className="text-lg font-bold text-gray-900">Plans &amp; billing</h1>

      <div className="rounded-lg border border-cyan-100 bg-[#E8F4F8] p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xl font-bold text-[#0E7490]">{currentRow.name}</span>
          <span className="text-sm text-gray-500">€{currentRow.monthlyEur}/month</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {currentRow.mandates} mandate{currentRow.mandates === 1 ? '' : 's'} · {currentRow.seats} seats · up to {currentRow.monthlyCap} qualified opportunities/mo
        </p>
        {pending && (
          <p className="mt-1.5 text-xs text-amber-700">
            Request to switch to <b>{INVESTOR_PLANS.find((p) => p.tier === pending)?.name}</b> sent — the team will take care of it. No automatic charge.
          </p>
        )}
        {err && <p className="mt-1.5 text-xs text-[#B00000]">{err}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {INVESTOR_PLANS.map((p) => (
          <div key={p.tier} className={`rounded-lg border p-4 ${p.tier === current ? 'border-[#0E7490]' : 'border-gray-200'}`}>
            <div className="text-sm font-bold text-gray-900">{p.name}</div>
            <div className="mt-0.5 text-xs text-gray-400">{p.tagline}</div>
            <div className="mt-2 text-lg font-semibold text-[#0E7490]">€{p.monthlyEur}<span className="text-xs font-normal text-gray-400">/mo</span></div>
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
              {p.bullets.map((b) => <li key={b}>· {b}</li>)}
            </ul>
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
        ))}
      </div>

      <p className="text-[11px] text-gray-400">No payment processing in this version — a plan-change request is recorded and the team applies it manually.</p>
    </div>
  );
}
