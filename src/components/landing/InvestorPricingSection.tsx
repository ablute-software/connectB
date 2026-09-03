'use client';
// Investor-side pricing block for /investors. Same Monthly/Annual toggle
// pattern as the founder PricingSection, but reads from INVESTOR_PLANS
// (plans.ts) — no free tier. All six prices are founder-confirmed (Prompt
// 501 removed the last `annualPending` placeholders).
import { useState } from 'react';
import { INVESTOR_PLANS, INVESTOR_PLAN_FOOTNOTES } from '@/lib/plans';
import { PrivateDetectiveCard } from '@/components/plans/PrivateDetectiveCard';
import s from '@/app/landing.module.css';

function Check() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 12.5l3.6 3.6L18.5 7.5" stroke="#2a7f8e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Prompt 548 Part 4 — two optional props so the guest Plans preview can
// reuse this block verbatim. Both default to exactly what the landing page
// rendered before, so that page is untouched.
export function InvestorPricingSection({ signupHref = '/signup?as=investor', ctaLabel = 'Claim your profile' }: {
  signupHref?: string; ctaLabel?: string;
} = {}) {
  const [annual, setAnnual] = useState(false);

  return (
    <section className={`${s.sec} ${s.pricingSec}`} id="pricing">
      <div className={`${s.wrap} ${s.wrapPricingInvestor}`}>
        <div className={s.secHead} data-reveal>
          <span className={s.eyebrow}>Pricing</span>
          <h2>Plans built for how funds actually work</h2>
          <p>No free tier. Every plan is verified access, from day one.</p>
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
          <span>Annual <span className={s.save}>save ~20%</span></span>
        </div>

        <div className={`${s.plans} ${s.plansInvestor}`}>
          {INVESTOR_PLANS.map((p, i) => {
            const popular = p.tier === 'ace_spotter';
            const delay = i === 1 ? s.d1 : i === 2 ? s.d2 : '';
            const amount = annual ? p.annualPerMonthEur : p.monthlyEur;
            const billing = annual
              ? `billed €${p.annualEur.toLocaleString('en-US')}/yr + VAT`
              : 'billed monthly + VAT';

            return (
              <div key={p.tier} className={`${s.plan} ${popular ? s.pop : ''} ${s.rv} ${delay}`} data-reveal>
                {popular && <span className={s.flag}>Most popular</span>}
                <h3>{p.name}</h3>
                <p className={s.who}>{p.tagline}</p>
                <div className={s.price}>
                  <span>€{amount}</span>
                  <small>/month</small>
                </div>
                <p className={s.perYear}>{billing}</p>
                {/* PLAN-06 — from array order alone, never a hand-written
                    string per tier: Ace Spotter says "...in Pro Scout",
                    The Legendary Sleuth says "...in Ace Spotter", never both
                    on the same card. */}
                {i > 0 && <p className={s.who} style={{ fontWeight: 600 }}>Everything in {INVESTOR_PLANS[i - 1].name}, plus:</p>}
                <ul>
                  {p.bullets.map((b) => (
                    <li key={b}><Check />{b}</li>
                  ))}
                </ul>
                <p className={s.perYear} style={{ marginTop: 8 }}>
                  {INVESTOR_PLAN_FOOTNOTES.dataRoom}<br />{INVESTOR_PLAN_FOOTNOTES.dueDiligence}
                </p>
                {/* Prompt 501 — investor plans ARE in Stripe now (see
                    /api/stripe/investor-checkout), but this CTA deliberately
                    still points at signup, not checkout: checkout needs a
                    `catalog_entity_id`, which only exists once the investor
                    has created or joined a firm. The founder's own public
                    PricingSection.tsx does exactly the same (href="/signup",
                    verified before changing this) — a public pricing page
                    sells the plan, the workspace sells the checkout. */}
                <a className={`${s.btn} ${popular ? s.btnTeal : s.btnGhostLight}`} href={signupHref}>{ctaLabel}</a>
              </div>
            );
          })}
          <PrivateDetectiveCard className={`${s.plan} ${s.rv} ${s.d2}`} />
        </div>

        <p className={`${s.teaser} ${s.rv}`} data-reveal>
          Up to {INVESTOR_PLANS[INVESTOR_PLANS.length - 1].monthlyCap} thesis-qualified opportunities analysed
          every month. Sherlock delivers only the matches that deserve your team&apos;s attention.
        </p>
        <p className={`${s.vat} ${s.rv}`} data-reveal style={{ textAlign: 'center', marginTop: 12 }}>
          All plans: verified access, consent-based data, no lead dumps. Prices exclude VAT.
        </p>
      </div>
    </section>
  );
}
