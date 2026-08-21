'use client';
// Prompt 292 §Fase 1 (Pedidos 1+2+6) — manual/admin path to feed the
// shared investor_investments library (migration 0201). Deliberately a
// plain form, not an AI-assisted one: that's Pedido 4 (Fase 2, silent
// background research via enrichment_jobs) — this is the minimum viable
// version where an admin who already has a real source records it
// directly, same "never invent a value" discipline as everywhere else in
// the catalog.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface InvestmentRow {
  id: string; investorName: string; investorPersonName: string | null;
  companyName: string; companyDomain: string | null; companySectors: string[];
  amountEur: number | null; investedAt: string | null; roundType: string | null;
  stakePctAtInvestment: number | null; stillHeld: boolean | null;
  soldAt: string | null; soldAmountEur: number | null; stakePctCurrent: number | null;
  source: string | null; confidence: 'high' | 'medium' | 'low' | null; createdAt: string;
}

function fmtEur(n: number | null): string {
  if (n == null) return '—';
  return `€${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })}k`;
}

function InvestmentRowView({ r }: { r: InvestmentRow }) {
  return (
    <li className="rounded-lg border border-gray-100 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">{r.investorName}</span>
        {r.investorPersonName && <span className="text-xs text-gray-500">({r.investorPersonName})</span>}
        <span className="text-xs text-gray-400">→</span>
        <span className="font-medium text-gray-900">{r.companyName}</span>
        {r.confidence && (
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
            r.confidence === 'high' ? 'bg-emerald-50 text-emerald-700' : r.confidence === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
            {r.confidence} confidence
          </span>
        )}
      </div>
      <div className="mt-1.5 grid gap-1 text-xs text-gray-600 sm:grid-cols-4">
        <div><span className="text-gray-400">Amount:</span> {fmtEur(r.amountEur)}</div>
        <div><span className="text-gray-400">Invested:</span> {r.investedAt ?? '—'} {r.roundType ? `(${r.roundType})` : ''}</div>
        <div><span className="text-gray-400">Status:</span> {r.stillHeld == null ? 'unknown' : r.stillHeld ? 'still held' : `sold${r.soldAt ? ` ${r.soldAt}` : ''}${r.soldAmountEur ? ` for ${fmtEur(r.soldAmountEur)}` : ''}`}</div>
        <div><span className="text-gray-400">Source:</span> {r.source ?? '—'}</div>
      </div>
    </li>
  );
}

export function CompetitorIntelTab() {
  const [items, setItems] = useState<InvestmentRow[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [showNewCompanyFields, setShowNewCompanyFields] = useState(false);

  const [investorName, setInvestorName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyDomain, setCompanyDomain] = useState('');
  const [companySectors, setCompanySectors] = useState('');
  const [companyDescription, setCompanyDescription] = useState('');
  const [amountEur, setAmountEur] = useState('');
  const [investedAt, setInvestedAt] = useState('');
  const [roundType, setRoundType] = useState('');
  const [stakePctAtInvestment, setStakePctAtInvestment] = useState('');
  const [stillHeld, setStillHeld] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const [soldAt, setSoldAt] = useState('');
  const [soldAmountEur, setSoldAmountEur] = useState('');
  const [stakePctCurrent, setStakePctCurrent] = useState('');
  const [source, setSource] = useState('');
  const [confidence, setConfidence] = useState<'' | 'high' | 'medium' | 'low'>('');

  function refresh() {
    fetch('/api/backoffice/competitor-investments').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setItems(body.items);
    }).catch((e) => setErr((e as Error).message));
  }
  useEffect(refresh, []);

  function resetForm() {
    setInvestorName(''); setCompanyName(''); setCompanyDomain(''); setCompanySectors(''); setCompanyDescription('');
    setAmountEur(''); setInvestedAt(''); setRoundType(''); setStakePctAtInvestment('');
    setStillHeld('unknown'); setSoldAt(''); setSoldAmountEur(''); setStakePctCurrent('');
    setSource(''); setConfidence(''); setShowNewCompanyFields(false);
  }

  async function submit() {
    if (!investorName.trim() || !companyName.trim()) { setFormErr('Investor and company are both required.'); return; }
    setBusy(true); setFormErr('');
    try {
      const res = await fetch('/api/backoffice/competitor-investments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          investorName: investorName.trim(), companyName: companyName.trim(),
          companyFields: {
            domain: companyDomain.trim() || undefined,
            sectors: companySectors.trim() ? companySectors.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
            description: companyDescription.trim() || undefined,
          },
          amountEur: amountEur ? Number(amountEur) : undefined,
          investedAt: investedAt || undefined,
          roundType: roundType.trim() || undefined,
          stakePctAtInvestment: stakePctAtInvestment ? Number(stakePctAtInvestment) : undefined,
          stillHeld: stillHeld === 'unknown' ? undefined : stillHeld === 'yes',
          soldAt: soldAt || undefined,
          soldAmountEur: soldAmountEur ? Number(soldAmountEur) : undefined,
          stakePctCurrent: stakePctCurrent ? Number(stakePctCurrent) : undefined,
          source: source.trim() || undefined,
          confidence: confidence || undefined,
        }),
      });
      const body = await res.json();
      if (!body.ok) { setFormErr(body.error); return; }
      resetForm();
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      <Card title="Record a competitor investment">
        <p className="mb-3 text-xs text-gray-500">
          Manual entry for Fase 1 — this is a shared library across every startup on the platform, not per-org data.
          Leave a field blank rather than guess; a real source and an honest confidence matter more than a full form.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-gray-600">
            Investor (must match a catalog fund exactly)
            <input value={investorName} onChange={(e) => setInvestorName(e.target.value)} placeholder="e.g. Speedinvest Health"
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-gray-600">
            Company invested in
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Withings"
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
          </label>
        </div>

        <button type="button" onClick={() => setShowNewCompanyFields((v) => !v)} className="mt-2 text-xs text-[#0E7490] hover:underline">
          {showNewCompanyFields ? '− Hide' : '+ Add'} details for a new company (only used if this company isn&apos;t already in the library)
        </button>
        {showNewCompanyFields && (
          <div className="mt-2 grid gap-2 rounded border border-gray-100 bg-gray-50 p-2 sm:grid-cols-3">
            <label className="text-xs text-gray-600">Domain
              <input value={companyDomain} onChange={(e) => setCompanyDomain(e.target.value)} placeholder="withings.com"
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs text-gray-600">Sectors (comma-separated)
              <input value={companySectors} onChange={(e) => setCompanySectors(e.target.value)} placeholder="healthtech, wearables"
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs text-gray-600 sm:col-span-1">Description
              <input value={companyDescription} onChange={(e) => setCompanyDescription(e.target.value)}
                className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
            </label>
          </div>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <label className="text-xs text-gray-600">Amount (EUR)
            <input value={amountEur} onChange={(e) => setAmountEur(e.target.value)} type="number" placeholder="500000"
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-gray-600">Invested on
            <input value={investedAt} onChange={(e) => setInvestedAt(e.target.value)} type="date"
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-gray-600">Round type
            <input value={roundType} onChange={(e) => setRoundType(e.target.value)} placeholder="Series A"
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-gray-600">Stake at investment (%)
            <input value={stakePctAtInvestment} onChange={(e) => setStakePctAtInvestment(e.target.value)} type="number" step="0.1"
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-gray-600">Still holds position?
            <select value={stillHeld} onChange={(e) => setStillHeld(e.target.value as typeof stillHeld)}
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm">
              <option value="unknown">Unknown</option>
              <option value="yes">Yes</option>
              <option value="no">No — sold/exited</option>
            </select>
          </label>
          {stillHeld === 'no' && (
            <>
              <label className="text-xs text-gray-600">Sold on
                <input value={soldAt} onChange={(e) => setSoldAt(e.target.value)} type="date"
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
              </label>
              <label className="text-xs text-gray-600">Sold for (EUR)
                <input value={soldAmountEur} onChange={(e) => setSoldAmountEur(e.target.value)} type="number"
                  className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
              </label>
            </>
          )}
          <label className="text-xs text-gray-600">Current stake (%, if known)
            <input value={stakePctCurrent} onChange={(e) => setStakePctCurrent(e.target.value)} type="number" step="0.1"
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-gray-600 sm:col-span-2">Source
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="TechCrunch, Aug 2024, https://…"
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-gray-600">Confidence
            <select value={confidence} onChange={(e) => setConfidence(e.target.value as typeof confidence)}
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm">
              <option value="">—</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
        </div>

        {formErr && <p className="mt-2 text-xs text-[#B00000]">{formErr}</p>}
        <button disabled={busy} onClick={submit}
          className="mt-3 rounded bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {busy ? 'Saving…' : 'Record investment'}
        </button>
      </Card>

      <Card title={`Recorded investments (${items?.length ?? 0})`}>
        {!items ? <p className="text-sm text-gray-400">Loading…</p> : items.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing recorded yet.</p>
        ) : (
          <ul className="space-y-2">{items.map((r) => <InvestmentRowView key={r.id} r={r} />)}</ul>
        )}
      </Card>
    </div>
  );
}
