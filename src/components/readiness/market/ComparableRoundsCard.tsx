'use client';
// Prompt 384 §B.3 — "Comparable rounds": the benchmark an investor will ask
// the founder to justify against ("what should I benchmark you against?").
// No new AI, no new query — /api/market-data/competitors already joins each
// tracked competitor to its own known funding rounds (investor_investments,
// the exact same join dossier-fetch.ts's own `rounds` group uses for the
// investor-facing dossier — src/app/portal/startup/[orgId]/page.tsx's
// MarketTab already renders this to the investor). This card is the
// founder-facing mirror: today these rounds only ever reach the investor,
// the founder never sees them laid out together.
//
// Prompt 481 — this card IS the Capital Landscape. The prompt assumed the
// section had to be built from scratch because Prompt 460 removed
// players/rounds "porque os dados não eram fiáveis"; 460's own commit says
// otherwise (it removed menu entries pointing at a static placeholder, and
// says the real cards live in the Market analysis tab — this one). So 481
// extends what already worked instead of rebuilding it: a third source
// (the founder's own entries) and, mandatory on every single row, the
// warning that matches where that row came from.
import { useEffect, useState } from 'react';
import { noticeForSource, isFounderEntered, type CapitalRoundSource } from '@/lib/capital-landscape';

// Prompt 447 §D.4 — reads the server-merged `rounds` (market-rounds-
// merge.ts) instead of deriving it client-side from `competitors`: rounds
// now also include accepted `rounds` research items (445's
// RoundStructured), not just tracked competitors' own known funding
// history. Already sorted and deduped server-side — no client logic left.
interface ComparableRound {
  companyName: string; investorName: string | null; amountEur: number | null; investedAt: string | null;
  roundType: string | null; source: CapitalRoundSource;
}

function fmtEur(v: number | null): string | null {
  return v == null ? null : `€${v.toLocaleString()}`;
}

// Prompt 481 §2 — always available, never gated by the state of the public
// search. A founder who just wants to record what they already know does
// not wait for anything.
function AddRoundForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ companyName: '', investorName: '', amountEur: '', roundType: '', investedAt: '', sourceUrl: '' });

  async function submit() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/market-data/capital-rounds', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyName: form.companyName,
          investorName: form.investorName || undefined,
          // Only send a number when one was actually typed — an empty box
          // must stay unknown, never become 0.
          amountEur: form.amountEur.trim() ? Number(form.amountEur) : undefined,
          roundType: form.roundType || undefined,
          investedAt: form.investedAt || undefined,
          sourceUrl: form.sourceUrl || undefined,
        }),
      });
      const body = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!body?.ok) { setError(body?.error ?? 'Could not save this round — try again.'); return; }
      setForm({ companyName: '', investorName: '', amountEur: '', roundType: '', investedAt: '', sourceUrl: '' });
      setOpen(false);
      onAdded();
    } catch {
      setError('Could not reach the server — check your connection and try again.');
    } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[11px] font-medium text-[#0E7490] hover:underline">
        + Add a round you know about
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 p-2.5">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {([
          ['companyName', 'Company *', 'Acme Diagnostics'],
          ['investorName', 'Investor', 'Nina Capital'],
          ['amountEur', 'Amount (€)', '2000000'],
          ['roundType', 'Round', 'Seed'],
          ['investedAt', 'Date', '2026-03'],
          ['sourceUrl', 'Source (if you have one)', 'https://…'],
        ] as const).map(([key, label, placeholder]) => (
          <label key={key} className="text-[11px] text-gray-600">
            {label}
            <input value={form[key]} placeholder={placeholder}
              onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
              className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          </label>
        ))}
      </div>
      {/* §4 — said at the point of entry too, not only on the row
          afterwards: the founder should know whose responsibility this is
          before they type it, not after. */}
      <p className="mt-1.5 text-[10px] text-amber-700">
        You&apos;re responsible for verifying anything you enter here before it&apos;s shared with investors.
      </p>
      {error && <p className="mt-1 text-[11px] text-[#B00000]">{error}</p>}
      <div className="mt-1.5 flex items-center gap-2">
        <button type="button" onClick={() => void submit()} disabled={busy || !form.companyName.trim()}
          className="rounded bg-[#0E7490] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40">
          {busy ? 'Saving…' : 'Save round'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(''); }} className="text-[11px] text-gray-400 hover:underline">Cancel</button>
      </div>
    </div>
  );
}

export function ComparableRoundsCard() {
  const [rows, setRows] = useState<ComparableRound[] | null>(null);

  function load() {
    fetch('/api/market-data/competitors').then((r) => r.json()).then((body) => {
      setRows((body.rounds ?? []) as ComparableRound[]);
    }).catch(() => setRows([]));
  }
  useEffect(load, []);

  if (rows === null) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400">
          No sourced rounds yet — they come from the funding history of the competitors you track below. Add competitors
          with known investors and their rounds show up here automatically, or record one you already know about.
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-500">Rounds to benchmark against — what an investor will ask you to justify your own ask against.</p>
          {/* Prompt 499 §3 — was `overflow-hidden`, which CUT the five
              columns off on a phone instead of letting them scroll. `auto`
              still clips to the rounded corners (that was the original
              job), and adds the scroll. */}
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-2.5 py-1.5">Date</th>
                  <th className="px-2.5 py-1.5">Company</th>
                  <th className="px-2.5 py-1.5">Round</th>
                  <th className="px-2.5 py-1.5">Amount</th>
                  <th className="px-2.5 py-1.5">Investor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-2.5 py-1.5 align-top text-gray-500">{r.investedAt ? r.investedAt.slice(0, 7) : '—'}</td>
                    <td className="px-2.5 py-1.5 align-top font-medium text-gray-800">
                      {r.companyName}
                      {/* Prompt 481 §3/§4/§5 — the warning belongs to the
                          ROW, keyed off that row's own provenance. Never a
                          single banner at the top of the section covering
                          both cases at once, and never both sentences on
                          one item: noticeForSource returns exactly one. */}
                      <span className={`mt-0.5 block text-[10px] font-normal ${isFounderEntered(r.source) ? 'text-amber-700' : 'text-gray-400'}`}>
                        {noticeForSource(r.source)}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 align-top text-gray-600">{r.roundType ?? '—'}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 align-top text-gray-600">{fmtEur(r.amountEur) ?? '—'}</td>
                    <td className="px-2.5 py-1.5 align-top text-gray-500">{r.investorName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <AddRoundForm onAdded={load} />
    </div>
  );
}
