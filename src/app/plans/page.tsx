'use client';
// Plans & Account batch (B) — "Planos e conta". Shows the org's current plan,
// the three tiers (names/prices verbatim from plans.ts), and the success-fee
// terms. NO payment processing: the upgrade CTA files a plan-change REQUEST
// that a platform admin flips manually in the back-office. Terms are shown with
// a "sujeitos a contrato" caveat and no consent checkbox — nothing here is an
// accepted agreement.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import {
  PLANS, SUCCESS_FEE_COPY, SUCCESS_FEE_CAVEAT, normalizePlan, planName,
} from '@/lib/plans';
import { can, type OrgRole } from '@/lib/permissions';
import type { PlanTier } from '@/lib/types';

export default function PlansPage() {
  const { db } = useStore();
  const [me, setMe] = useState<{ authEnabled: boolean; plan?: PlanTier; orgRole?: OrgRole; capabilities?: { planAccounts?: boolean } } | null>(null);
  const [requesting, setRequesting] = useState<PlanTier | null>(null);
  const [requestedLocal, setRequestedLocal] = useState<PlanTier | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then(setMe).catch(() => setMe({ authEnabled: false }));
  }, []);

  // Current tier: the server's answer when authed, else the store's org value
  // (demo mode / while /api/me loads), always run through normalizePlan.
  const current: PlanTier = me?.plan ?? normalizePlan(db.org.plan);
  const pending: PlanTier | null =
    requestedLocal ?? (db.org.plan_change_requested ? normalizePlan(db.org.plan_change_requested) : null);

  const requestsEnabled = !!me?.authEnabled && !!me?.capabilities?.planAccounts;
  const canRequest = !!me?.orgRole && can(me.orgRole, 'manage_org_settings');

  async function requestPlan(tier: PlanTier) {
    setErr(''); setRequesting(tier);
    try {
      const res = await fetch('/api/plan/request', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Não foi possível enviar o pedido.'); return; }
      setRequestedLocal(tier);
    } finally {
      setRequesting(null);
    }
  }

  function ctaFor(tier: PlanTier) {
    if (tier === current) return <span className="rounded-full bg-[#E8F4F8] px-3 py-1 text-xs font-semibold text-[#0E7490]">Plano atual</span>;
    if (pending) {
      return pending === tier
        ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Pedido enviado</span>
        : <span className="text-[11px] text-gray-400">Pedido pendente para {planName(pending)}</span>;
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

  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-lg font-bold">Planos e conta</h1>

      <Card title="O teu plano" tint="blue">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xl font-bold text-[#0E7490]">{planName(current)}</span>
          <span className="text-sm text-gray-500">{PLANS.find((p) => p.tier === current)?.monthly}</span>
        </div>
        {pending && (
          <p className="mt-1.5 text-xs text-amber-700">
            Pedido de mudança para <b>{planName(pending)}</b> enviado — a equipa vai tratar disto. Sem cobrança automática.
          </p>
        )}
        {err && <p className="mt-1.5 text-xs text-[#B00000]">{err}</p>}
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => {
          const isCurrent = p.tier === current;
          return (
            <div key={p.tier}
              className={`flex flex-col rounded-2xl border bg-white p-4 shadow-sm ${isCurrent ? 'border-[#0E7490] ring-1 ring-[#0E7490]' : 'border-gray-100'}`}>
              <div className="text-sm font-bold text-gray-800">{p.name}</div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-2xl font-bold text-[#0E7490]">{p.monthly}</span>
              </div>
              {p.annual
                ? <div className="mt-0.5 text-[11px] text-gray-400">{p.annual}</div>
                : <div className="mt-0.5 text-[11px] text-gray-300">—</div>}
              <ul className="mt-3 flex-1 space-y-1 text-xs text-gray-600">
                <li>{p.paid ? '✓ Personalização de mensagens por AI' : '· Templates mecânicos + escrita manual'}</li>
                <li>· Pipeline, data room e disciplina de outreach</li>
              </ul>
              <div className="mt-3">{ctaFor(p.tier)}</div>
            </div>
          );
        })}
      </div>

      <Card title="Success fee">
        <p className="text-sm text-gray-700">{SUCCESS_FEE_COPY}</p>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-500">
          <span>ⓘ</span> {SUCCESS_FEE_CAVEAT}
        </div>
      </Card>

      <p className="text-[11px] text-gray-400">
        Sem processamento de pagamentos nesta versão — um pedido de mudança de plano é registado e a equipa aplica-o manualmente.
      </p>
    </div>
  );
}
