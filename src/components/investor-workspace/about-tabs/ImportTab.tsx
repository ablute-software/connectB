'use client';
// Prompt 421 §C — self-declared past investments. Framed as value
// exchange, never mandatory: this feeds reopen-signals.ts's
// newInvestmentsSince (Prompt 416) as a complementary source alongside the
// market-researched investor_investments table — see
// declaredInvestmentToReopenRecord in reopen-signals.ts for the shape this
// maps into.
import { useEffect, useState } from 'react';

interface DeclaredInvestment {
  id: string; company_name: string; sector: string | null; invested_at: string | null;
  round_type: string | null; amount_eur: number | null;
}

function fmtEur(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

export function ImportTab() {
  const [investments, setInvestments] = useState<DeclaredInvestment[] | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [sector, setSector] = useState('');
  const [investedAt, setInvestedAt] = useState('');
  const [roundType, setRoundType] = useState('');
  const [amountEur, setAmountEur] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function load() {
    fetch('/api/portal/investor-profile/declared-investments').then((r) => r.json())
      .then((d) => setInvestments(d.linked ? d.investments : []));
  }
  useEffect(load, []);

  async function add() {
    if (!companyName.trim()) { setErr('Company name is required.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/portal/investor-profile/declared-investments', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim(), sector: sector.trim() || null, investedAt: investedAt || null,
          roundType: roundType.trim() || null, amountEur: amountEur ? Number(amountEur) : null,
        }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not save.'); return; }
      setCompanyName(''); setSector(''); setInvestedAt(''); setRoundType(''); setAmountEur('');
      load();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    await fetch(`/api/portal/investor-profile/declared-investments?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Your investment history</h2>
        <p className="mt-1 text-xs text-gray-500">
          Helps Sherlock match you with better-fit startups, and gives founders more confidence in your profile.
          Entirely optional — add what you&apos;re comfortable sharing.
        </p>

        {investments === null ? (
          <p className="mt-3 text-xs text-gray-400">Loading…</p>
        ) : investments.length === 0 ? (
          <p className="mt-3 text-xs text-gray-400">Nothing added yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {investments.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <span className="font-medium text-gray-900">{inv.company_name}</span>
                  <span className="ml-2 text-gray-500">
                    {[inv.sector, inv.round_type, inv.invested_at, inv.amount_eur != null ? fmtEur(inv.amount_eur) : null]
                      .filter(Boolean).join(' · ')}
                  </span>
                </div>
                <button onClick={() => remove(inv.id)} className="shrink-0 text-gray-400 hover:text-[#B00000]">Remove</button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-gray-100 pt-3">
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name"
            className="col-span-2 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
          <input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Sector (optional)"
            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
          <input value={roundType} onChange={(e) => setRoundType(e.target.value)} placeholder="Round (optional, e.g. Seed)"
            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
          <input type="date" value={investedAt} onChange={(e) => setInvestedAt(e.target.value)}
            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
          <input type="number" value={amountEur} onChange={(e) => setAmountEur(e.target.value)} placeholder="Amount € (optional)"
            className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
        </div>
        {err && <p className="mt-1.5 text-[11px] text-[#B00000]">{err}</p>}
        <button onClick={add} disabled={busy} className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {busy ? 'Adding…' : 'Add investment'}
        </button>
      </div>
    </div>
  );
}
