'use client';
// Plans & Account — "Planos e conta". Current plan + the three tiers with a
// Mensal/Anual billing toggle. NO payment processing: the upgrade CTA files a
// plan-change REQUEST (tier + chosen period) that a platform admin flips
// manually in the back-office. The success fee is SUSPENDED (post legal
// consultation) — subscriptions are the only charge; a single discreet
// consultancy note stands in its place, with no percentages or terms.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import {
  PLANS, CONSULTANCY_TEASER, BILLING_PERIODS, planPriceLabel, parsePlanRequest,
  normalizePlan, planName, type BillingPeriod,
} from '@/lib/plans';
import { can, type OrgRole } from '@/lib/permissions';
import type { PlanTier } from '@/lib/types';

const PERIOD_LABEL: Record<BillingPeriod, string> = { monthly: 'Mensal', annual: 'Anual' };

export default function PlansPage() {
  const { db } = useStore();
  const [me, setMe] = useState<{ authEnabled: boolean; plan?: PlanTier; orgRole?: OrgRole; capabilities?: { planAccounts?: boolean } } | null>(null);
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const [requesting, setRequesting] = useState<PlanTier | null>(null);
  const [requestedLocal, setRequestedLocal] = useState<{ tier: PlanTier; period: BillingPeriod } | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then(setMe).catch(() => setMe({ authEnabled: false }));
  }, []);

  // Current tier: the server's answer when authed, else the store's org value
  // (demo mode / while /api/me loads), always run through normalizePlan.
  const current: PlanTier = me?.plan ?? normalizePlan(db.org.plan);
  const pending: { tier: PlanTier; period: BillingPeriod } | null =
    requestedLocal ?? (db.org.plan_change_requested ? parsePlanRequest(db.org.plan_change_requested) : null);

  const requestsEnabled = !!me?.authEnabled && !!me?.capabilities?.planAccounts;
  const canRequest = !!me?.orgRole && can(me.orgRole, 'manage_org_settings');

  async function requestPlan(tier: PlanTier) {
    setErr(''); setRequesting(tier);
    try {
      const res = await fetch('/api/plan/request', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier, period }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Não foi possível enviar o pedido.'); return; }
      setRequestedLocal({ tier, period });
    } finally {
      setRequesting(null);
    }
  }

  function ctaFor(tier: PlanTier) {
    if (tier === current) return <span className="rounded-full bg-[#E8F4F8] px-3 py-1 text-xs font-semibold text-[#0E7490]">Plano atual</span>;
    if (pending) {
      return pending.tier === tier
        ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Pedido enviado</span>
        : <span className="text-[11px] text-gray-400">Pedido pendente para {planName(pending.tier)}</span>;
    }
    if (!requestsEnabled) {
      return <span className="text-[11px] text-gray-400" title={me?.authEnabled ? 'Disponível quando a migração 0028 estiver aplicada.' : 'Disponível na versão publicada.'}>Pedidos em breve</span>;
    }
    if (!canRequest) {
      return <span className="text-[11px] text-gray-400">Só o owner/admin pode pedir.</span>;
    }
    return (
      <button onClick={() => requestPlan(tier)} disabled={requesting === tier}
        className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0c637b] disabled:opacity-40">
        {requesting === tier ? 'A enviar…' : `Pedir ${planName(tier)}`}
      </button>
    );
  }

  const currentRow = PLANS.find((p) => p.tier === current);

  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-lg font-bold">Planos e conta</h1>

      <Card title="O teu plano" tint="blue">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xl font-bold text-[#0E7490]">{planName(current)}</span>
          {currentRow && <span className="text-sm text-gray-500">{planPriceLabel(currentRow, period)}</span>}
        </div>
        {pending && (
          <p className="mt-1.5 text-xs text-amber-700">
            Pedido de mudança para <b>{planName(pending.tier)}</b> ({PERIOD_LABEL[pending.period]}) enviado — a equipa vai tratar disto. Sem cobrança automática.
          </p>
        )}
        {err && <p className="mt-1.5 text-xs text-[#B00000]">{err}</p>}
      </Card>

      {/* Billing period toggle — drives every price below. */}
      <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-white p-0.5 text-xs w-fit">
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
                <li>{p.paid ? '✓ Personalização de mensagens por AI' : '· Templates mecânicos + escrita manual'}</li>
                <li>· Pipeline, data room e disciplina de outreach</li>
              </ul>
              <div className="mt-3">{ctaFor(p.tier)}</div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400">{CONSULTANCY_TEASER}</p>

      <p className="text-[11px] text-gray-400">
        Sem processamento de pagamentos nesta versão — um pedido de mudança de plano é registado e a equipa aplica-o manualmente.
      </p>
    </div>
  );
}
