'use client';
// Plans & Billing. Current plan + three tiers with a Monthly/Annual toggle.
// Two modes, decided by whether billing (Stripe) is configured server-side:
//   • billing ON  → "Choose this plan" opens secure checkout; "Manage
//                   subscription" opens the customer portal (invoices, card,
//                   switch, cancel).
//   • billing OFF → the CTA files a plan-change request the platform team
//                   applies manually (unchanged).
// No card data touches this code — checkout/portal are hosted. Copy says
// "secure payment", never the provider's name. Success fee is suspended.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import {
  PLANS, CONSULTANCY_TEASER_EN_LEAD, CONSULTANCY_TEASER_EN_REST, BILLING_PERIODS,
  planPriceLabel, parsePlanRequest, normalizePlan, planName, type BillingPeriod,
} from '@/lib/plans';
import { SECURE_PAYMENT_COPY } from '@/lib/billing';
import { can, type OrgRole } from '@/lib/permissions';
import type { PlanTier } from '@/lib/types';

const PERIOD_LABEL: Record<BillingPeriod, string> = { monthly: 'Monthly', annual: 'Annual' };

export default function PlansPage() {
  const { db } = useStore();
  const [me, setMe] = useState<{ authEnabled: boolean; plan?: PlanTier; orgRole?: OrgRole; capabilities?: { planAccounts?: boolean; billing?: boolean } } | null>(null);
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const [busy, setBusy] = useState<PlanTier | 'portal' | null>(null);
  const [requestedLocal, setRequestedLocal] = useState<{ tier: PlanTier; period: BillingPeriod } | null>(null);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then(setMe).catch(() => setMe({ authEnabled: false }));
    // Post-checkout return (?checkout=success|cancel) — read client-side to
    // avoid a Suspense boundary for useSearchParams.
    const q = new URLSearchParams(window.location.search).get('checkout');
    if (q === 'success') setNotice('Subscription confirmed — your plan updates automatically within seconds.');
    else if (q === 'cancel') setNotice('Payment cancelled — nothing was charged.');
  }, []);

  const current: PlanTier = me?.plan ?? normalizePlan(db.org.plan);
  const pending: { tier: PlanTier; period: BillingPeriod } | null =
    requestedLocal ?? (db.org.plan_change_requested ? parsePlanRequest(db.org.plan_change_requested) : null);

  const billing = !!me?.capabilities?.billing;
  const requestsEnabled = !!me?.authEnabled && !!me?.capabilities?.planAccounts;
  const canManage = !!me?.orgRole && can(me.orgRole, 'manage_org_settings');
  const hasSubscription = !!db.org.stripe_subscription_id;

  async function checkout(tier: PlanTier) {
    setErr(''); setBusy(tier);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier, period }),
      });
      const body = await res.json();
      if (body.ok && body.url) { window.location.href = body.url; return; }
      setErr(body.error ?? 'Could not start checkout.');
    } finally {
      setBusy((b) => (b === tier ? null : b));
    }
  }

  async function openPortal() {
    setErr(''); setBusy('portal');
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const body = await res.json();
      if (body.ok && body.url) { window.location.href = body.url; return; }
      setErr(body.error ?? 'Could not open the billing portal.');
    } finally {
      setBusy((b) => (b === 'portal' ? null : b));
    }
  }

  async function requestPlan(tier: PlanTier) {
    setErr(''); setBusy(tier);
    try {
      const res = await fetch('/api/plan/request', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier, period }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not send the request.'); return; }
      setRequestedLocal({ tier, period });
    } finally {
      setBusy((b) => (b === tier ? null : b));
    }
  }

  function ctaFor(tier: PlanTier) {
    if (tier === current) return <span className="rounded-full bg-[#E8F4F8] px-3 py-1 text-xs font-semibold text-[#0E7490]">Current plan</span>;

    // Billing ON — real checkout for paid tiers; downgrade to free is done in
    // the portal (cancel), so the free card just points there.
    if (billing) {
      if (tier === 'idea') {
        return hasSubscription
          ? <span className="text-[11px] text-gray-400">Downgrade from “Manage subscription”.</span>
          : null;
      }
      if (!canManage) return <span className="text-[11px] text-gray-400">Only the owner/admin can subscribe.</span>;
      return (
        <button onClick={() => checkout(tier)} disabled={busy === tier}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0c637b] disabled:opacity-40">
          {busy === tier ? 'Opening…' : 'Choose this plan'}
        </button>
      );
    }

    // Billing OFF — the manual request flow (unchanged).
    if (pending) {
      return pending.tier === tier
        ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Request sent</span>
        : <span className="text-[11px] text-gray-400">Request pending for {planName(pending.tier)}</span>;
    }
    if (!requestsEnabled) {
      return <span className="text-[11px] text-gray-400" title={me?.authEnabled ? 'Available once migration 0028 is applied.' : 'Available on the published version.'}>Requests coming soon</span>;
    }
    if (!canManage) return <span className="text-[11px] text-gray-400">Only the owner/admin can request this.</span>;
    return (
      <button onClick={() => requestPlan(tier)} disabled={busy === tier}
        className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0c637b] disabled:opacity-40">
        {busy === tier ? 'Sending…' : `Request ${planName(tier)}`}
      </button>
    );
  }

  const currentRow = PLANS.find((p) => p.tier === current);

  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-lg font-bold">Plans &amp; billing</h1>

      {notice && <div className="rounded-lg border border-cyan-100 bg-[#E8F4F8] px-3 py-2 text-xs text-[#0E7490]">{notice}</div>}

      <Card title="Your plan" tint="blue"
        right={billing && hasSubscription && canManage ? (
          <button onClick={openPortal} disabled={busy === 'portal'}
            className="rounded-lg border border-cyan-200 bg-white px-2.5 py-1 text-xs font-medium text-[#0E7490] hover:bg-cyan-50 disabled:opacity-40">
            {busy === 'portal' ? 'Opening…' : 'Manage subscription'}
          </button>
        ) : undefined}>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xl font-bold text-[#0E7490]">{planName(current)}</span>
          {currentRow && <span className="text-sm text-gray-500">{planPriceLabel(currentRow, period)}</span>}
        </div>
        {!billing && pending && (
          <p className="mt-1.5 text-xs text-amber-700">
            Request to switch to <b>{planName(pending.tier)}</b> ({PERIOD_LABEL[pending.period]}) sent — the team will take care of it. No automatic charge.
          </p>
        )}
        {err && <p className="mt-1.5 text-xs text-[#B00000]">{err}</p>}
      </Card>

      {/* Billing period toggle — drives every price below. */}
      <div className="flex w-fit items-center gap-1 rounded-full border border-gray-200 bg-white p-0.5 text-xs">
        {BILLING_PERIODS.map((pd) => (
          <button key={pd} onClick={() => setPeriod(pd)}
            className={`rounded-full px-3 py-1 font-medium transition ${period === pd ? 'bg-[#0E7490] text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}>
            {PERIOD_LABEL[pd]}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => {
          const isCurrent = p.tier === current;
          return (
            <div key={p.tier}
              className={`flex flex-col rounded-2xl border bg-white p-4 shadow-sm ${isCurrent ? 'border-[#0E7490] ring-1 ring-[#0E7490]' : 'border-gray-100'}`}>
              <div className="text-sm font-bold text-gray-800">{p.name}</div>
              <div className="mt-1.5 text-[15px] font-bold text-[#0E7490]">{planPriceLabel(p, period)}</div>
              <ul className="mt-3 flex-1 space-y-1 text-xs text-gray-600">
                <li>{p.paid ? '✓ AI-personalized messaging' : '· Mechanical templates + manual writing'}</li>
                <li>· Pipeline, data room and outreach discipline</li>
              </ul>
              <div className="mt-3">{ctaFor(p.tier)}</div>
            </div>
          );
        })}
      </div>

      {billing && <p className="text-[11px] text-gray-400">🔒 {SECURE_PAYMENT_COPY}. Cancel anytime.</p>}

      <p className="text-xs text-gray-400"><b>{CONSULTANCY_TEASER_EN_LEAD}</b>{CONSULTANCY_TEASER_EN_REST}</p>

      {!billing && (
        <p className="text-[11px] text-gray-400">
          No payment processing in this version — a plan-change request is recorded and the team applies it manually.
        </p>
      )}
    </div>
  );
}
