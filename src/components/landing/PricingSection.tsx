'use client';
// Landing pricing block. The Monthly/Annual switch is real React state (rather
// than the reference's DOM mutation), and every number comes from plans.ts —
// the same module the in-app Plans page uses — so prices can never drift
// between the marketing page and the product.
import { useEffect, useState } from 'react';
import { PLANS, buildPlanSections } from '@/lib/plans';
import type { PlanTier } from '@/lib/types';
import s from '@/app/landing.module.css';
import { PrivateDetectiveCard } from '@/components/plans/PrivateDetectiveCard';

function Check() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 12.5l3.6 3.6L18.5 7.5" stroke="#2a7f8e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Landing-only copy per tier (audience line, CTA label) — the feature list
// itself is no longer hand-maintained here (Prompt 749: "single source, no
// drift"). This used to have its own short bullets that didn't derive from
// plans.ts's own PLANS data at all — including "Priority support", which
// matched nothing in the actual product. Editorial call, flagged in
// DECISIONS.md: the compact teaser below is now the first 4 section TITLES
// of the exact same buildPlanSections() the in-app Plans page renders in
// full (seats, AI credits, curated pipeline, MatchDeal) — same numbers,
// same wording, guaranteed not to drift, at the cost of losing the
// previously hand-picked marketing phrasing. The old muted/crossed-out
// "coming soon" treatment is dropped along with it: every tier's AI-credits
// section is now a real, present feature (just a smaller number on idea),
// so there's nothing left to show crossed out.
const COPY: Record<PlanTier, { who: string; cta: string }> = {
  idea: { who: 'For your very first steps', cta: 'Start free' },
  garage: { who: 'For rounds already in motion', cta: 'Choose this plan' },
  motherfunding: { who: 'For serious, multi-investor raises', cta: 'Choose this plan' },
};

export function PricingSection() {
  const [annual, setAnnual] = useState(false);
  // Prompt 749 — live from the backoffice, same public /api/plan-credits
  // read PlansPanel.tsx uses; no fallback to a guessed number on failure.
  const [aiCredits, setAiCredits] = useState<Partial<Record<PlanTier, number>>>({});
  useEffect(() => {
    fetch('/api/plan-credits', { cache: 'no-store' }).then((r) => r.json())
      .then((body) => { if (body.ok) setAiCredits(body.credits ?? {}); }).catch(() => {});
  }, []);

  return (
    <section className={`${s.sec} ${s.pricingSec}`} id="pricing">
      {/* Prompt 690 §2 — a 4th card (Private Detective) joins the grid, same
          layout problem BUG-03 already solved on the investor side: .wrap's
          1140px max-width and .plans' 3-column grid were sized for 3 cards.
          Reusing .wrapPricingInvestor/.plansInvestor rather than adding a
          near-duplicate pair of "wide wrap + 4 columns" rules under a new
          name — the rules are plain layout, nothing investor-specific. */}
      <div className={`${s.wrap} ${s.wrapPricingInvestor}`}>
        <div className={s.secHead} data-reveal>
          <span className={s.eyebrow}>Pricing</span>
          <h2>Plans that grow up with you</h2>
          <p>Start free. Upgrade when the round gets serious.</p>
        </div>

        <div className={s.toggle} data-reveal>
          <span>Monthly</span>
          <button
            type="button"
            role="switch"
            aria-checked={annual}
            aria-label="Bill annually"
            onClick={() => setAnnual((a) => !a)}
            className={`${s.switchEl} ${annual ? s.switchOn : ''}`}
          />
          <span>Annual <span className={s.save}>save ~26%</span></span>
        </div>

        <div className={`${s.plans} ${s.plansInvestor}`}>
          {PLANS.map((p, i) => {
            const copy = COPY[p.tier];
            const features = buildPlanSections(p.tier, aiCredits[p.tier] ?? null).slice(0, 4).map((sec) => sec.title);
            // Prompt 128 — was 'garage' ("Most popular"); the landing's own
            // popular/highlighted-card flag is unrelated to the in-app Plans
            // page's "Best value" badge (PlansPanel.tsx computes that one
            // separately, exclusively on the butler tier's annual view via
            // plans.ts's bestValue field) — two different components, two
            // different badges, no shared state to keep in sync.
            const popular = p.tier === 'motherfunding';
            const delay = i === 1 ? s.d1 : i === 2 ? s.d2 : '';
            const amount = p.paid
              ? `€${annual ? p.annualPerMonthEur : p.monthlyEur}`
              : `€${p.monthlyEur}`;
            const billing = p.paid
              ? (annual && p.annualEur ? `billed €${p.annualEur.toLocaleString('en-US')} per year` : 'billed monthly')
              : 'free forever';

            return (
              <div key={p.tier} className={`${s.plan} ${popular ? s.pop : ''} ${s.rv} ${delay}`} data-reveal>
                {popular && <span className={s.flag}>Recommended</span>}
                <h3>{p.name}</h3>
                <p className={s.who}>{copy.who}</p>
                <div className={s.price}>
                  <span>{amount}</span>
                  {p.paid && <small>/month</small>}
                </div>
                <p className={s.perYear}>{billing}</p>
                <ul>
                  {features.map((f) => (
                    <li key={f}><Check />{f}</li>
                  ))}
                </ul>
                <a className={`${s.btn} ${popular ? s.btnTeal : s.btnGhostLight}`} href="/signup">{copy.cta}</a>
              </div>
            );
          })}
          <PrivateDetectiveCard className={`${s.plan} ${s.rv} ${s.d2}`} dataReveal variant="founder" source="pricing_private_detective_founder" />
        </div>
      </div>
    </section>
  );
}
