'use client';
// Prompt 550 — the presentational half of Plans & billing, extracted from
// InvestorPlansPanel so a guest and a signed-in investor see the SAME cards.
//
// Why this file exists at all: the guest preview was rendering
// InvestorPricingSection — the LANDING page's pricing block. Its cards carry
// landing.module.css's `.rv`, which is `opacity: 0` until something sets
// `[data-in='true']`, and the only thing that ever does is LandingEffects, an
// IntersectionObserver mounted by /app/page.tsx and /app/investors/page.tsx
// and by nothing else. Inside the workspace shell there is no LandingEffects,
// so the cards stayed invisible forever while their text sat in the DOM.
//
// Nothing here belongs to landing.module.css, and nothing here has
// data-reveal. That is the point: this grid renders visible on first paint,
// with no observer, no animation and no dependency on which page mounted it.
//
// The markup below is MOVED from InvestorPlansPanel, not rewritten — the only
// change is that the four CTA branches became a `renderCta` prop, because the
// CTA is the one thing that genuinely differs between the two callers.
import type { ReactNode } from 'react';
import { INVESTOR_PLANS, INVESTOR_PLAN_FOOTNOTES, type InvestorPlanTier } from '@/lib/plans';
import { priceFor as priceForPlan, type BillingMode as Billing } from '@/lib/investor-plan-pricing';
import { PrivateDetectiveCard } from '@/components/plans/PrivateDetectiveCard';

// Re-exported so callers keep importing one thing; the implementation lives
// in a JSX-free module because vitest cannot import this file.
export { priceFor, type BillingMode } from '@/lib/investor-plan-pricing';

export function InvestorPlanGrid({ billing, onBillingChange, current, renderCta }: {
  billing: Billing;
  onBillingChange: (b: Billing) => void;
  /** Highlights the matching card. null for a guest, who has no plan yet. */
  current?: InvestorPlanTier | null;
  renderCta: (plan: typeof INVESTOR_PLANS[number]) => ReactNode;
}) {
  return (
    <>
      {/* Prompt 121 §2.4 — Monthly/Annual toggle, one selection for the
          whole grid (not per-card): every priced tier reads the same
          `billing` state. data-tour-id kept so guide_plans still anchors. */}
      <div data-tour-id="plans-toggle" className="flex items-center gap-1.5">
        {(['monthly', 'annual'] as const).map((b) => (
          <button key={b} onClick={() => onBillingChange(b)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${billing === b ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {b === 'monthly' ? 'Monthly' : 'Annual'}
          </button>
        ))}
      </div>

      {/* BUG-03 (fixed) — this grid used to inherit InvestorWorkspaceShell's
          max-w-3xl (768px) <main>, which Tailwind's viewport-based `lg:`
          breakpoint doesn't know about: 4 columns inside 768px would
          squeeze each card to ~183px. The shell now gives the Plans tab a
          wider max-w-6xl container specifically, so lg:grid-cols-4 has
          room to actually mean 4 columns; degrades to 2x2 below that, and
          1 column on mobile (4-across on a phone is illegible). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {INVESTOR_PLANS.map((p, i) => {
          const price = priceForPlan(p, billing);
          return (
            <div key={p.tier} className={`flex flex-col rounded-lg border p-4 ${p.tier === current ? 'border-[#0E7490]' : 'border-gray-200'}`}>
              <div className="text-sm font-bold text-gray-900">{p.name}</div>
              <div className="mt-0.5 text-xs text-gray-400">{p.tagline}</div>
              <div className="mt-2 text-lg font-semibold text-[#0E7490]">
                €{price}<span className="text-xs font-normal text-gray-400">/mo</span>
              </div>
              {billing === 'annual' && (
                <p className="mt-0.5 text-[10px] text-gray-400">
                  €{p.annualEur}/year
                </p>
              )}
              {/* PLAN-06 — order-derived, so it can't skip a tier or repeat two headers on one card. */}
              {i > 0 && <p className="mt-2 text-xs font-semibold text-gray-700">Everything in {INVESTOR_PLANS[i - 1].name}, plus:</p>}
              <ul className="mt-2 flex-1 space-y-1 text-xs text-gray-600">
                {p.bullets.map((b) => <li key={b}>· {b}</li>)}
              </ul>
              <p className="mt-2 text-[10px] text-gray-400">{INVESTOR_PLAN_FOOTNOTES.dataRoom} {INVESTOR_PLAN_FOOTNOTES.dueDiligence}</p>
              <div className="mt-3">{renderCta(p)}</div>
            </div>
          );
        })}
        {/* Private Detective has no fixed price at all (PLAN-02 — a contact
            form, not a checkout) — the toggle above has nothing to change
            on this card, which is exactly "the same value in both modes". */}
        <PrivateDetectiveCard className="flex flex-col rounded-lg border border-gray-200 p-4" />
      </div>
    </>
  );
}
