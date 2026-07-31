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
        // The first plan has nothing before it to be "new" relative to —
        // without this guard, newBulletsSince(p, undefined) treats an empty
        // previous set as the baseline and tags every one of its own
        // bullets "New", which is wrong (confirmed live: it did exactly
        // that before this guard existed).
        const isNew = i === 0 ? new Set<string>() : newBulletsSince(p, plans[i - 1]);
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
              {p.bullets.map((b) => (
                <li key={b} className={`flex items-start gap-1.5 ${isNew.has(b) ? 'font-semibold text-gray-800' : ''}`}>
                  <span className={isNew.has(b) ? 'text-[#0E7490]' : 'text-gray-400'}>✓</span>
                  <span>
                    {b}
                    {isNew.has(b) && (
                      <span className="ml-1.5 rounded-full bg-[#E8F4F8] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#0E7490]">New</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-4">{renderCta(p)}</div>
          </div>
        );
      })}
    </div>
  );
}
