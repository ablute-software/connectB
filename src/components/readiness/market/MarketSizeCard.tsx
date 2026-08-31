'use client';
// Prompt 487 — Block 2 of the North Star: what do we know / how do we know
// it / how confident / why does it matter, answered in one read, where the
// founder already looks.
//
// It reads the SAME /api/market-data/facts the MarketFactsCard reads, and
// the same market-facts-view.ts helpers. No new route, no new write path,
// no second copy of anything. What is new is only the reading:
// MarketFactsCard is the audit register — correct, and the last thing on the
// screen, grouped into technical zones. This is the answer that register
// exists to support.
//
// For ablute_ today that answer is "not yet", and that is the point rather
// than a shortfall: measured 31/08, all 67 market_facts rows are
// founder_reported and NOT ONE is bottom_up, so there is no number this card
// is allowed to put in a headline (Prompt 487 §2). The external estimates
// stay visible underneath, labelled, never promoted.
import { useEffect, useState } from 'react';
import { retrievalMethodLabel, type FactView, type FactZone } from '@/lib/market-facts-view';
import { describeAvailableMaterial, synthesiseMarketSize } from '@/lib/market-size-synthesis';

type FactWithZone = FactView & { zone: FactZone };

export function MarketSizeCard() {
  const [facts, setFacts] = useState<FactWithZone[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [openEvidence, setOpenEvidence] = useState(false);

  useEffect(() => {
    fetch('/api/market-data/facts').then((r) => r.json()).then((body) => {
      if (!body.available) { setAvailable(false); return; }
      setFacts((body.facts ?? []) as FactWithZone[]);
    }).catch(() => setAvailable(false));
  }, []);

  if (!available) return null;
  if (!facts) return <p className="text-sm text-gray-400">Loading…</p>;

  const s = synthesiseMarketSize(facts);
  const headlineFacts = s.headline ? facts.filter((f) => s.headline!.factIds.includes(f.id)) : [];
  const evidence = headlineFacts.flatMap((f) => f.evidence);

  return (
    <div className="space-y-2">
      {s.headline ? (
        <>
          {/* What do we know */}
          <div className="space-y-0.5">
            {s.headline.lines.map((line, i) => (
              <p key={i} className="text-sm font-medium text-gray-800">{line}</p>
            ))}
          </div>
          {/* How do we know it — the method is stated, always, because the
              method is what separates this from an analyst's guess. */}
          <p className="text-xs text-gray-600">
            Built bottom-up{s.headline.lines.length > 1 ? ` — ${s.headline.lines.length} separate estimates, shown as they were read, never merged into one` : ''}.
          </p>
          {/* How confident */}
          <p className="text-[11px] text-amber-700">{s.headline.confidenceLabel}</p>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-700">{s.gap!.sentence}</p>
          {describeAvailableMaterial(s.gap!) && (
            <p className="text-xs text-gray-500">{describeAvailableMaterial(s.gap!)}</p>
          )}
        </>
      )}

      {/* Why does it matter — the fourth question, and the only one that is
          the same sentence whether or not there is a number. */}
      <p className="text-xs text-gray-500">{s.whyItMatters}</p>

      {evidence.length > 0 && (
        <div>
          <button type="button" onClick={() => setOpenEvidence((v) => !v)} className="text-[11px] font-medium text-[#0E7490] hover:underline">
            {openEvidence ? 'Hide' : 'Why do we know this?'}
          </button>
          {openEvidence && (
            <ul className="mt-1 space-y-0.5">
              {evidence.map((e, i) => (
                <li key={i} className="text-[11px] text-gray-500">
                  {e.documentName ?? 'A document'}{e.page ? `, page ${e.page}` : ''}
                  {e.quote ? ` — "${e.quote}"` : ''} ({retrievalMethodLabel(e.retrievalMethod)})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {s.sideEvidence.length > 0 && (
        <div className="rounded-lg border border-gray-200 p-2.5">
          <p className="text-[11px] font-medium text-gray-600">
            Other figures Sherlock has read — not used for the number above
          </p>
          <ul className="mt-1 space-y-0.5">
            {s.sideEvidence.slice(0, 5).map((e) => (
              <li key={e.factId} className="text-[11px] text-gray-500">
                {e.line} <span className="text-gray-400">· {e.methodLabel}</span>
              </li>
            ))}
          </ul>
          {s.sideEvidence.length > 5 && (
            <p className="mt-1 text-[10px] text-gray-400">
              and {s.sideEvidence.length - 5} more — the full register is at the bottom of this tab.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
