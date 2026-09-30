'use client';
// Generic pricing cards — used by /plans (founders) today; built to also
// serve the Investor Workspace plans page (Phase 0) and any future landing
// pricing block from the same component, per one-implementation-three-uses.
// Takes plain PlanCardData + a renderCta callback so checkout/request/signup
// behaviour stays entirely with the caller — this component only presents.
import type { PlanCardData } from './types';

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
      {plans.map((p) => {
        const isCurrent = p.id === currentId;
        // Prompt 749 — every plan states its own COMPLETE, independent
        // feature list now (no more "only show what's new since the
        // previous tier" filtering — that stays in UpgradeConfirmModal,
        // whose job is specifically the delta).
        const notes = Array.from(new Set(p.sections.map((s) => s.note).filter((n): n is string => !!n)));
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
            {p.annualPriceLine && <div className="text-[11px] text-gray-400">{p.annualPriceLine}</div>}
            {p.annualPerMonthLine && <div className="text-[11px] text-gray-400">{p.annualPerMonthLine}</div>}
            {p.promoNote && (
              <div className="mt-1.5 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                {p.promoNote}
              </div>
            )}

            <ul className="mt-4 flex-1 space-y-1.5 text-xs text-gray-600">
              {p.sections.map((s) => (
                <li key={s.title} className="flex items-start gap-1.5">
                  <span className="text-gray-400">✓</span>
                  <span>
                    {s.title}
                    {s.items.length > 0 && (
                      <ul className="mt-1 space-y-0.5 pl-1 font-normal text-gray-500">
                        {s.items.map((item) => <li key={item.text}>· {item.text}</li>)}
                      </ul>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {notes.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-[11px] text-gray-400">
                {notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            )}

            <div className="mt-4">{renderCta(p)}</div>
          </div>
        );
      })}
    </div>
  );
}
