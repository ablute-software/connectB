'use client';
// Prompt 467 §D — typed market_facts, surfaced by verification_status,
// never validation_status ("well-formed" ≠ "true" — see market-facts-
// view.ts's factZone for the exact precedence). Replaces the old growth/
// market_size proposal cards for document-sourced items going forward;
// segments/players/trends/regulatory are untouched and keep rendering in
// FromYourDocumentsPanel's own "Proposed from your documents" list, right
// above where this card is mounted.
import { useEffect, useState } from 'react';
import {
  factSummaryLine, groupIncompleteByMarket, incompleteZoneSummary,
  missingFieldsLabel, retrievalMethodLabel,
  type FactView, type FactZone,
} from '@/lib/market-facts-view';

type FactWithZone = FactView & { zone: FactZone };

export function MarketFactsCard() {
  const [facts, setFacts] = useState<FactWithZone[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/market-data/facts').then((r) => r.json()).then((body) => {
      if (!body.available) { setAvailable(false); return; }
      setFacts((body.facts ?? []) as FactWithZone[]);
    }).catch(() => setAvailable(false));
  }, []);

  if (!available || !facts || facts.length === 0) return null;

  const actionable = facts.filter((f) => f.zone === 'actionable');
  const founderReported = facts.filter((f) => f.zone === 'founder_reported');
  const incomplete = facts.filter((f) => f.zone === 'incomplete');
  const invalid = facts.filter((f) => f.zone === 'invalid');

  return (
    <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
      {actionable.length > 0 && (
        <FactGroup title="Market Intelligence" titleClassName="text-[#0E7490]" facts={actionable} borderClassName="border-cyan-100" openId={openId} setOpenId={setOpenId} />
      )}

      {/* Prompt 467 v3 §5 — no "conflicting" zone: nothing in this
          pipeline (or market-facts-db.ts's deriveVerificationStatus) can
          produce that status today. Add it back alongside the cross-fact
          comparison that would actually compute it. */}

      {founderReported.length > 0 && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Founder-reported · unverified</p>
          <p className="mb-1.5 text-[11px] text-gray-400">From your own documents — not yet confirmed by an outside source. Never shown to investors as market fact.</p>
          <div className="space-y-1.5">
            {founderReported.map((f) => <FactCard key={f.id} fact={f} borderClassName="border-gray-200" openId={openId} setOpenId={setOpenId} />)}
          </div>
        </div>
      )}

      {incomplete.length > 0 && <IncompleteZone facts={incomplete} />}

      {invalid.length > 0 && (
        <details className="text-xs text-gray-400">
          <summary className="cursor-pointer select-none">Audit — {invalid.length} item{invalid.length === 1 ? '' : 's'} could not be validated</summary>
          <div className="mt-1.5 space-y-1.5">
            {invalid.map((f) => (
              <div key={f.id} className="rounded-lg border border-red-100 bg-red-50/40 p-2 text-[11px] text-red-700">
                {factSummaryLine(f)} — {f.validation.errors.join('; ')}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// Prompt 496 — support material, not the answer. Two nested <details>: the
// zone itself collapses to one line, and opening it shows one line per
// market rather than every row at once.
//
// WHY BOTH, when the prompt offered either. Collapsing alone would fix
// "biggest thing on screen" and then, on the first click, reproduce exactly
// the wall it was meant to remove — 68 undifferentiated rows with nothing
// separating smart toilet from biosensors from digital health. A cap alone
// ("showing 5, and 63 more") leaves the zone at the same visual weight and
// replaces the wall with a number carrying no structure. Grouped-and-nested
// is the only combination where opening the zone tells the founder
// something — which markets there is raw material for, and how much —
// instead of just showing more of it.
//
// The <details> vocabulary is not new here: the `invalid` zone below has
// used it since Prompt 467, so this reuses a pattern the card already has
// rather than introducing one.
//
// DELIBERATELY NO "Why do we know this?" on these rows (prompt's own
// out-of-scope list, and the file's rule behind it): an incomplete fact is
// malformed or missing context by definition, and putting provenance beside
// it would lend it a credibility that factZone has already ruled it does
// not have — verification_status only decides among `valid` facts.
function IncompleteZone({ facts }: { facts: FactWithZone[] }) {
  const groups = groupIncompleteByMarket(facts);
  return (
    <details className="text-xs text-gray-400">
      <summary className="cursor-pointer select-none">
        <span className="text-[10px] font-medium uppercase tracking-wide">Incomplete</span>
        {' — '}{incompleteZoneSummary(facts.length, groups.length)}
      </summary>
      <p className="mt-1 text-[11px] text-gray-400">
        Read from your documents, but missing the context that would make them usable — kept here so nothing is lost.
      </p>
      <div className="mt-1.5 space-y-1">
        {groups.map((g) => (
          // Keyed on the raw value, not the label: a market literally named
          // "Market not stated" would otherwise collide with the null group.
          <details key={JSON.stringify(g.marketDefinition)} className="rounded-lg border border-gray-100 bg-gray-50 px-2 py-1.5">
            <summary className="cursor-pointer select-none text-[11px] text-gray-500">
              {g.label} <span className="text-gray-400">· {g.facts.length}</span>
            </summary>
            <div className="mt-1 space-y-1">
              {g.facts.map((f) => (
                <p key={f.id} className="text-[11px] text-gray-500">
                  {factSummaryLine(f)} — {missingFieldsLabel(f.validation.missing)}
                </p>
              ))}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}

function FactGroup({ title, titleClassName, facts, borderClassName, openId, setOpenId }: {
  title: string; titleClassName: string; facts: FactWithZone[]; borderClassName: string;
  openId: string | null; setOpenId: (id: string | null) => void;
}) {
  return (
    <div>
      <p className={`text-[10px] font-medium uppercase tracking-wide ${titleClassName}`}>{title}</p>
      <div className="mt-1 space-y-1.5">
        {facts.map((f) => <FactCard key={f.id} fact={f} borderClassName={borderClassName} openId={openId} setOpenId={setOpenId} />)}
      </div>
    </div>
  );
}

function FactCard({ fact, borderClassName, openId, setOpenId }: {
  fact: FactWithZone; borderClassName: string; openId: string | null; setOpenId: (id: string | null) => void;
}) {
  const open = openId === fact.id;
  return (
    <div className={`rounded-lg border ${borderClassName} p-2.5`}>
      <p className="text-sm text-gray-800">{factSummaryLine(fact)}</p>
      {fact.zone === 'founder_reported' && fact.evidence[0] && (
        <p className="mt-0.5 text-[11px] text-gray-400">
          From your deck{fact.evidence[0].page ? `, page ${fact.evidence[0].page}` : ''} — unverified
        </p>
      )}
      <button onClick={() => setOpenId(open ? null : fact.id)} className="mt-1 text-[11px] text-[#0E7490] underline">
        {open ? 'Hide' : 'Why do we know this?'}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 border-t border-gray-100 pt-1.5">
          {fact.evidence.length === 0 && <p className="text-[11px] text-gray-400">No provenance recorded for this fact.</p>}
          {fact.evidence.map((e, i) => (
            <p key={i} className="text-[11px] text-gray-500">
              {e.documentName ?? 'Vault document'}{e.page ? `, page ${e.page}` : ''}
              {e.quote ? ` — "${e.quote}"` : ''} ({retrievalMethodLabel(e.retrievalMethod)})
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
