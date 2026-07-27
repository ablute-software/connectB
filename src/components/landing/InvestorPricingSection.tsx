'use client';
// Investor-side pricing block for /investors. Same Monthly/Annual toggle
// pattern as the founder PricingSection, but reads from INVESTOR_PLANS
// (plans.ts) — no free tier, and the two higher annual prices are marked
// `annualPending` until the founder confirms them (still rendered so the
// page is functional, just easy to swap in plans.ts when confirmed).
import { useState } from 'react';
import { INVESTOR_PLANS } from '@/lib/plans';
import s from '@/app/landing.module.css';

function Check() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 12.5l3.6 3.6L18.5 7.5" stroke="#2a7f8e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function InvestorPricingSection() {
  const [annual, setAnnual] = useState(false);

  return (
    <section className={`${s.sec} ${s.pricingSec}`} id="pricing">
      <div className={s.wrap}>
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

        <div className={s.plans}>
          {INVESTOR_PLANS.map((p, i) => {
            const popular = p.tier === 'pro_spotter';
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
                <ul>
                  {p.bullets.map((b) => (
                    <li key={b}><Check />{b}</li>
                  ))}
                </ul>
                {/* Investor plans don't exist in Stripe yet — CTA points at the
                    same signup entry point as the rest of the page, not checkout. */}
                <a className={`${s.btn} ${popular ? s.btnTeal : s.btnGhostLight}`} href="/signup?as=investor">Claim your profile</a>
              </div>
            );
          })}
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
