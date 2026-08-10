'use client';
// Generic pricing cards — used by /plans (founders) today; built to also
// serve the Investor Workspace plans page (Phase 0) and any future landing
// pricing block from the same component, per one-implementation-three-uses.
// Takes plain PlanCardData + a renderCta callback so checkout/request/signup
// behaviour stays entirely with the caller — this component only presents.
import type { PlanCardData } from './types';
import { newBulletsSince } from './types';

export function PlanCards({
  plans,
  currentId,
  renderCta,
}: {
  plans: PlanCardData[];
  currentId?: string;
  renderCta: (plan: PlanCardData) => React.ReactNode;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {plans.map((p, i) => {
        const isCurrent = p.id === currentId;
        // Prompt 158 §6 — each feature is shown once, on the card of the
        // first plan that includes it; later plans don't repeat it (the
        // comparison table still ticks ✓ for every plan that has it — see
        // ComparisonTable.tsx, untouched by this). newBulletsSince still
        // does the real work here (bullets are cumulative arrays per
        // plans.ts's own contract — "each tier's array is the previous
        // tier's plus what's new"), it just now controls which bullets
        // render at all instead of which get a "New" badge — Prompt 158 §3
        // removed the badge itself, not this function; UpgradeConfirmModal
        // still uses it unchanged for its own "what you gain by upgrading"
        // list, a different feature entirely.
        const newSincePrevious = i === 0 ? null : newBulletsSince(p, plans[i - 1]);
        const visibleBullets = newSincePrevious ? p.bullets.filter((b) => newSincePrevious.has(b)) : p.bullets;
        return (
          <div key={p.id}
            className={`relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm ${
              p.popular ? 'border-[#0E7490] ring-2 ring-[#0E7490]'
                : p.bestPrice ? 'border-orange-500 ring-2 ring-orange-500'
                : isCurrent ? 'border-[#0E7490] ring-1 ring-[#0E7490]' : 'border-gray-100'
            }`}>
            {p.popular && (
              <span className="absolute -top-3 left-4 rounded-full bg-[#0E7490] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                Most popular
              </span>
            )}
            {p.bestPrice && (
              <span className="absolute -top-3 left-4 rounded-full bg-orange-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                Best value
              </span>
            )}
            <div className="text-sm font-bold text-gray-800">{p.name}</div>
            {p.tagline && <div className="mt-0.5 text-xs text-gray-500">{p.tagline}</div>}
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-lg font-bold text-[#0E7490]">{p.priceLabel}</span>
            </div>
            {p.priceSubLabel && <div className="text-[11px] text-gray-400">{p.priceSubLabel}</div>}
            {p.promoNote && (
              <div className="mt-1.5 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                {p.promoNote}
              </div>
            )}

            <ul className="mt-4 flex-1 space-y-1.5 text-xs text-gray-600">
              {visibleBullets.map((b) => {
                // Prompt 123 §B.1 — a bullet can carry embedded sub-items
                // (e.g. "Investor Pipeline\n· 5 investors…") for doc-mandated
                // nested lists (Investor Pipeline, Access to MatchDeal).
                const [head, ...subLines] = b.split('\n');
                return (
                  <li key={b} className="flex items-start gap-1.5">
                    <span className="text-gray-400">✓</span>
                    <span>
                      {head}
                      {subLines.length > 0 && (
                        <ul className="mt-1 space-y-0.5 pl-1 font-normal text-gray-500">
                          {subLines.map((line) => <li key={line}>{line}</li>)}
                        </ul>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>

            {p.comingSoon && p.comingSoon.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-[11px] text-gray-400">
                {p.comingSoon.map((c) => (
                  <li key={c} className="flex items-start gap-1.5">
                    <span>◌</span>
                    <span>{c} <span className="italic">(coming soon)</span></span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4">{renderCta(p)}</div>
          </div>
        );
      })}
    </div>
  );
}
