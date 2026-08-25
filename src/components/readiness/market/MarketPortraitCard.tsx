'use client';
// Prompt 378 §D — the cold start. First visit to Market data used to be six
// blank cards with no obvious first move; this is the one button that turns
// the Vault the founder already paid to extract into a reviewable market
// portrait (rings from the sizing figures, competitor cards from the
// competitive-landscape findings). It reports what it produced, in words,
// every time — including "nothing found", which is a real answer, not a
// failure to show anything.
import { useState } from 'react';

interface PortraitResult {
  documentsRead: number; costEur: number; cached: boolean;
  ringsProposed: number; ringsNote: string | null; competitorsProposed: number;
}

export function MarketPortraitCard({ coldStart, onDone }: { coldStart: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PortraitResult | null>(null);

  async function build() {
    setBusy(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/market-data/portrait', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
      });
      // Same §A discipline as the section buttons: a 504/HTML answer must
      // become words on screen, never a rejected promise nobody catches.
      const body = await res.json().catch(() => null);
      if (!body) { setError('The pass took too long or failed on the server — try again.'); return; }
      if (!body.ok) { setError(body.error ?? 'Could not build your market portrait — try again.'); return; }
      setResult(body as PortraitResult);
      onDone();
    } catch {
      setError('Could not reach the server — check your connection and try again.');
    } finally { setBusy(false); }
  }

  return (
    <div className={`rounded-lg border p-4 ${coldStart ? 'border-[#0E7490] bg-[#E8F4F8]' : 'border-gray-200 bg-white'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h2 className="text-sm font-semibold text-gray-900">
            {coldStart ? 'Start here — build your market portrait' : 'Rebuild from your documents'}
          </h2>
          <p className="mt-1 text-xs text-gray-600">
            Reads the market-looking documents already in your Vault (sizing sheets, competitive landscape, your deck)
            and turns them into rings and competitor cards for you to review. Nothing is published, and nothing here
            is invented — every figure keeps the document and page it came from.
          </p>
        </div>
        <button onClick={build} disabled={busy}
          className="shrink-0 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {busy ? 'Reading your documents…' : coldStart ? 'Build my market portrait' : 'Re-read documents'}
        </button>
      </div>

      {error && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-[#B00000]">
          {error}
          <button onClick={build} disabled={busy} className="ml-2 font-medium underline disabled:opacity-40">Retry</button>
        </div>
      )}

      {result && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-700">
          Read {result.documentsRead} document{result.documentsRead === 1 ? '' : 's'}
          {result.cached ? ' (already read — no new cost)' : ` · €${result.costEur.toFixed(3)}`}.
          {' '}Proposed {result.ringsProposed} ring{result.ringsProposed === 1 ? '' : 's'}
          {' '}and {result.competitorsProposed} competitor{result.competitorsProposed === 1 ? '' : 's'} to review.
          {result.ringsNote && <span className="mt-1 block text-amber-700">{result.ringsNote}</span>}
          {result.ringsProposed === 0 && result.competitorsProposed === 0 && !result.ringsNote && (
            <span className="mt-1 block text-amber-700">
              Nothing market-related was found in those documents — try picking different ones with
              {' '}<span className="font-medium">Read my documents</span> below.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
