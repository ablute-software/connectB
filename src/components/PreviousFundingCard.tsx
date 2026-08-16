'use client';
// Prompt 212 §B.3 — "Previous funding": capital já levantado, no único sítio
// onde se edita.
//
// Existe porque não existia. Os €100k de uma ronda antiga da ablute_ estavam
// guardados como `interest_eur` de uma entrada do pipeline ("Nuno Marujo",
// não contactada) — a única forma que a app dava — e o review somava-os como
// soft-circled DESTA ronda, até o SWOT dizer ao investidor que só €100k de
// €300k estavam fechados. O dado nunca esteve errado; estava no sítio
// errado, porque o sítio certo não existia.
//
// As sugestões em baixo são o corolário: quando o número deixou de contar, a
// app tem de dizer porquê e oferecer a correcção — e a correcção não é a
// mesma para quem nunca foi contactado e para quem recusou.
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { suggestCapitalFixes, type CapitalFix } from '@/lib/round-capital';

function fmtEur(n: number) {
  return `€${n.toLocaleString('en-US')}`;
}

export function PreviousFundingCard() {
  const { db, addFundingRound, removeFundingRound, setInterest } = useStore();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [year, setYear] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const rounds = db.fundingRounds ?? [];
  const total = rounds.reduce((s, r) => s + Number(r.amount_eur), 0);
  const fixes = suggestCapitalFixes(db.entities);

  async function applyFix(f: CapitalFix) {
    setBusy(f.entityId);
    if (f.suggestion === 'move_to_previous_funding') {
      // Duas escritas, uma decisão: cria a ronda anterior E tira o valor da
      // entidade. Deixar o interest_eur para trás era duplicar o número em
      // dois sítios, que é exactamente o problema que isto vem resolver.
      const res = await addFundingRound({ label: f.name, amount_eur: f.amountEur });
      if (!res.error) setInterest(f.entityId, undefined);
    } else {
      setInterest(f.entityId, undefined);
    }
    setBusy(null);
  }

  return (
    <Card title="Previous funding">
      <p className="mb-2 text-xs text-gray-500">
        Capital you&apos;ve already raised, kept separate from the round you&apos;re raising now. This is the
        one place it lives — the profile, the investor dossier and the next review all read from here.
      </p>

      {fixes.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {fixes.map((f) => (
            <div key={f.entityId} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span className="min-w-0 flex-1">
                {f.suggestion === 'move_to_previous_funding' ? (
                  <>
                    <strong>{f.name}</strong> has {fmtEur(f.amountEur)} of interest recorded but was never contacted.
                    Is this capital from an earlier round?
                  </>
                ) : (
                  <>
                    <strong>{f.name}</strong> {f.status === 'passed' ? 'passed' : 'is parked'} — remove the{' '}
                    {fmtEur(f.amountEur)} of interest still recorded against them?
                  </>
                )}
              </span>
              <button
                disabled={busy === f.entityId}
                onClick={() => applyFix(f)}
                className="whitespace-nowrap rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white disabled:bg-gray-300">
                {f.suggestion === 'move_to_previous_funding' ? 'Move to Previous funding' : 'Remove interest'}
              </button>
            </div>
          ))}
        </div>
      )}

      {rounds.length > 0 ? (
        <ul className="mb-3 space-y-1">
          {rounds.map((r) => (
            <li key={r.id} className="flex items-baseline gap-2 text-sm">
              <span className="font-medium text-gray-900">{r.label}</span>
              <span className="tabular-nums text-gray-700">{fmtEur(Number(r.amount_eur))}</span>
              {r.closed_year && <span className="text-xs text-gray-400">{r.closed_year}</span>}
              <button onClick={() => removeFundingRound(r.id)}
                className="ml-auto text-[11px] text-gray-400 hover:text-[#B00000]">remove</button>
            </li>
          ))}
          <li className="border-t border-gray-100 pt-1 text-sm font-semibold text-gray-900">
            Total raised to date: {fmtEur(total)}
          </li>
        </ul>
      ) : (
        <p className="mb-3 text-xs text-gray-400">Nothing recorded yet.</p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Pre-seed, grant, F&F…"
          className="w-40 rounded border border-gray-300 px-2 py-1.5 text-sm" />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" placeholder="Amount €"
          className="w-32 rounded border border-gray-300 px-2 py-1.5 text-sm" />
        <input value={year} onChange={(e) => setYear(e.target.value)} type="number" min="1900" max="2100" placeholder="Year"
          className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm" />
        <button
          disabled={!label.trim() || !amount}
          onClick={async () => {
            await addFundingRound({
              label: label.trim(), amount_eur: Number(amount),
              closed_year: year ? Number(year) : undefined,
            });
            setLabel(''); setAmount(''); setYear('');
          }}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:bg-gray-300">
          Add
        </button>
      </div>
    </Card>
  );
}
