'use client';
// Investor Workspace Plans & billing (Prompt 74 Bloco 2). Shows the
// investor's current MatchDeal tier and the 3 priced tiers from plans.ts
// (INVESTOR_PLANS — names/prices are the founder's own spec, not invented
// here).
//
// Prompt 501 — agora com os DOIS modos que o PlansPanel do founder já tem,
// decididos pelo servidor (investor-profile devolve billing.configured, de
// investorBillingConfigured()):
//   • billing ON  → o botão abre checkout Stripe a sério; se a firma já tem
//                   subscrição, "Manage subscription" abre o portal.
//   • billing OFF → exactamente o comportamento anterior: grava um pedido em
//                   matchdeal_profiles.plan_tier_requested e a equipa aplica.
// O fallback não desaparece — é o que mantém a página funcional enquanto os
// 6 price IDs não existirem no Stripe, tal como o founder ficou antes de
// STRIPE_PRICE_GARAGE_* existir.
//
// Nenhum dado de cartão passa por aqui: checkout e portal são alojados.
import { useEffect, useState } from 'react';
import { INVESTOR_PLANS, INVESTOR_PLAN_FOOTNOTES, MATCHDEAL_TIER_TO_INVESTOR_PLAN as MATCHDEAL_TO_TIER, type InvestorPlanTier } from '@/lib/plans';
import { PrivateDetectiveCard } from '@/components/plans/PrivateDetectiveCard';
import { SECURE_PAYMENT_COPY } from '@/lib/billing';

interface Profile { plan_tier?: string | null; plan_tier_requested?: string | null }
interface BillingState { configured: boolean; hasSubscription: boolean; blocked?: boolean; lastPaidTier?: string | null }

export function InvestorPlansPanel() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [billingState, setBillingState] = useState<BillingState>({ configured: false, hasSubscription: false });
  const [busy, setBusy] = useState<InvestorPlanTier | 'portal' | null>(null);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [requestedLocal, setRequestedLocal] = useState<string | null>(null);
  // Prompt 121 §2.4 — Monthly/Annual toggle. INVESTOR_PLANS carries the
  // real annualEur/annualPerMonthEur values (all three confirmed by the
  // founder — Prompt 501 removed the last `annualPending` placeholders).
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');

  useEffect(() => {
    fetch('/api/portal/investor-profile').then((r) => r.json())
      .then((d) => {
        setProfile(d.linked ? d.profile : null);
        if (d.billing) setBillingState(d.billing);
      })
      .catch(() => setProfile(null));
    // Regresso do checkout (?checkout=success|cancel), mesma leitura
    // client-side que o PlansPanel do founder faz. O plano em si chega pelo
    // webhook, não por este parâmetro — daí o "a few seconds".
    const q = new URLSearchParams(window.location.search).get('checkout');
    if (q === 'success') setNotice('Payment received — your plan updates within a few seconds.');
    else if (q === 'cancel') setNotice('Checkout canceled — nothing was charged.');
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

  async function checkout(tier: InvestorPlanTier) {
    setErr(''); setNotice(''); setBusy(tier);
    try {
      const res = await fetch('/api/stripe/investor-checkout', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier, period: billing }),
      });
      const body = await res.json();
      if (body.ok && body.url) { window.location.href = body.url as string; return; }
      // 409: a firma já tem subscrição (outra pessoa da firma subscreveu
      // entretanto). Aprende com a resposta em vez de insistir — o botão
      // passa a "Manage subscription" sem precisar de recarregar a página.
      if (body.hasSubscription) setBillingState((b) => ({ ...b, hasSubscription: true }));
      setErr(body.error ?? 'Could not start checkout.');
    } finally { setBusy((b) => (b === tier ? null : b)); }
  }

  async function openPortal() {
    setErr(''); setNotice(''); setBusy('portal');
    try {
      const res = await fetch('/api/stripe/investor-portal', { method: 'POST' });
      const body = await res.json();
      if (body.ok && body.url) { window.location.href = body.url as string; return; }
      setErr(body.error ?? 'Could not open the billing portal.');
    } finally { setBusy((b) => (b === 'portal' ? null : b)); }
  }

  // O único sítio que decide entre os dois modos.
  const choosePlan = (tier: InvestorPlanTier) => (billingState.configured ? checkout(tier) : requestTier(tier));

  const currentRow = INVESTOR_PLANS.find((p) => p.tier === current)!;
  // Prompt 506 — o último plano pago vem de investor_billing.plan_tier (não
  // de matchdeal_profiles), que é precisamente porque este continua a ser
  // guardado quando o acesso é bloqueado: dá "you were on Ace Spotter" em
  // vez de um convite genérico.
  const lastPaidName = billingState.lastPaidTier
    ? INVESTOR_PLANS.find((p) => p.tier === MATCHDEAL_TO_TIER[billingState.lastPaidTier!])?.name ?? null
    : null;

  return (
    // Prompt 121 §2.4 correction — this panel's OWN root was still capped at
    // max-w-2xl (672px), independent of and undermining the shell's new
    // max-w-6xl <main>: 4 columns inside 672px squeezed each card to ~159px,
    // the same "thin, tall card" failure BUG-03 already named, just smaller.
    // Verified live (scratch route + getBoundingClientRect) before landing
    // this correction — see the commit message.
    <div className="max-w-6xl space-y-4">
      <h1 className="text-lg font-bold text-gray-900">Plans &amp; billing</h1>

      {/* Prompt 506 — a firma deixou de pagar. Bloco explícito e no topo, e
          NÃO um tier mais baixo mostrado em silêncio: o acesso está mesmo
          cortado do lado do servidor (resolveActiveInvestorMember devolve
          null para toda a workspace), portanto a página tem de dizer porquê
          e como voltar. O painel de Plans continua utilizável de propósito —
          é o caminho de volta. */}
      {billingState.blocked && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900">Your subscription has ended — access is paused</p>
          <p className="mt-1 text-xs text-amber-800">
            Your firm&apos;s workspace stays paused until a plan is active again. Nothing was deleted: pick a plan below
            {lastPaidName ? <> — you were on <b>{lastPaidName}</b></> : null} and everything comes back as it was.
          </p>
          {billingState.hasSubscription && (
            <button onClick={openPortal} disabled={busy === 'portal'}
              className="mt-2 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-800 disabled:opacity-40">
              {busy === 'portal' ? 'Opening…' : 'Reactivate in the billing portal'}
            </button>
          )}
        </div>
      )}

      <div data-tour-id="plans-current" className="rounded-lg border border-cyan-100 bg-[#E8F4F8] p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xl font-bold text-[#0E7490]">{currentRow.name}</span>
          <span className="text-sm text-gray-500">€{currentRow.monthlyEur}/month</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {currentRow.seats} seat{currentRow.seats === 1 ? '' : 's'} · up to {currentRow.monthlyCap} qualified opportunities/mo
        </p>
        {/* Só no modo pedido: com billing ligado, um pedido pendente deixa de
            ser o mecanismo — o pagamento é. */}
        {!billingState.configured && pending && (
          <p className="mt-1.5 text-xs text-amber-700">
            Request to switch to <b>{INVESTOR_PLANS.find((p) => p.tier === pending)?.name}</b> sent — the team will take care of it. No automatic charge.
          </p>
        )}
        {billingState.configured && billingState.hasSubscription && (
          <button onClick={openPortal} disabled={busy === 'portal'}
            className="mt-2 rounded-lg border border-[#0E7490] px-3 py-1.5 text-xs font-semibold text-[#0E7490] transition hover:bg-[#E8F4F8] disabled:opacity-40">
            {busy === 'portal' ? 'Opening…' : 'Manage subscription'}
          </button>
        )}
        {notice && <p className="mt-1.5 text-xs text-[#0E7490]">{notice}</p>}
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
                  €{p.annualEur}/year
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
                ) : !billingState.configured && pending === p.tier ? (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Request sent</span>
                ) : billingState.configured && billingState.hasSubscription ? (
                  // Uma subscrição por firma: trocar de tier é no portal, não
                  // um segundo checkout — mesma regra do lado founder.
                  <button onClick={openPortal} disabled={busy === 'portal'}
                    className="w-full rounded-lg border border-[#0E7490] px-3 py-1.5 text-xs font-semibold text-[#0E7490] transition hover:bg-[#E8F4F8] disabled:opacity-40">
                    {busy === 'portal' ? 'Opening…' : 'Switch in portal'}
                  </button>
                ) : (
                  <button onClick={() => choosePlan(p.tier)} disabled={busy === p.tier}
                    className="w-full rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0c637b] disabled:opacity-40">
                    {busy === p.tier
                      ? (billingState.configured ? 'Opening…' : 'Sending…')
                      : (billingState.configured ? `Choose ${p.name}` : `Request ${p.name}`)}
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

      {billingState.configured ? (
        <p className="text-[11px] text-gray-400">🔒 {SECURE_PAYMENT_COPY}. Cancel anytime.</p>
      ) : (
        <p className="text-[11px] text-gray-400">No payment processing in this version — a plan-change request is recorded and the team applies it manually.</p>
      )}
    </div>
  );
}
