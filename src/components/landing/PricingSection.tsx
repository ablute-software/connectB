'use client';
// Landing pricing block. The Monthly/Annual switch is real React state (rather
// than the reference's DOM mutation), and every number comes from plans.ts —
// the same module the in-app Plans page uses — so prices can never drift
// between the marketing page and the product.
import { useState } from 'react';
import {
  PLANS, CONSULTANCY_TEASER_EN_LEAD, CONSULTANCY_TEASER_EN_REST,
} from '@/lib/plans';
import type { PlanTier } from '@/lib/types';
import s from '@/app/landing.module.css';

function Check() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 12.5l3.6 3.6L18.5 7.5" stroke="#2a7f8e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Cross() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7l10 10M17 7L7 17" stroke="#c3d2d6" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// Landing-only copy per tier (audience line, feature bullets, CTA label).
const COPY: Record<PlanTier, { who: string; cta: string; features: { label: string; muted?: boolean }[] }> = {
  idea: {
    who: 'For the very first steps',
    cta: 'Start free',
    features: [
      { label: 'Investor pipeline & agenda' },
      { label: 'Company facts & consistency' },
      { label: 'Basic data room' },
      { label: 'AI drafting & review', muted: true },
    ],
  },
  garage: {
    who: 'For rounds in motion',
    cta: 'Choose this plan',
    features: [
      { label: 'Everything in the free plan' },
      { label: 'AI drafts, triage & review' },
      { label: 'NDA-protected sharing' },
      { label: 'Investor reawakening' },
    ],
  },
  motherfunding: {
    who: 'For serious, multi-investor raises',
    cta: 'Choose this plan',
    features: [
      { label: 'Everything in Garage' },
      { label: 'Advanced review & optimisation' },
      { label: 'Investability reports' },
      { label: 'Priority support' },
    ],
  },
};

export function PricingSection() {
  const [annual, setAnnual] = useState(false);

  return (
    <section className={`${s.sec} ${s.pricingSec}`} id="pricing">
      <div className={s.wrap}>
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

        <div className={s.plans}>
          {PLANS.map((p, i) => {
            const copy = COPY[p.tier];
            const popular = p.tier === 'garage';
            const delay = i === 1 ? s.d1 : i === 2 ? s.d2 : '';
            const amount = p.paid
              ? `€${annual ? p.annualPerMonthEur : p.monthlyEur}`
              : `€${p.monthlyEur}`;
            const billing = p.paid
              ? (annual && p.annualEur ? `billed €${p.annualEur.toLocaleString('en-US')} per year` : 'billed monthly')
              : 'free forever';

            return (
              <div key={p.tier} className={`${s.plan} ${popular ? s.pop : ''} ${s.rv} ${delay}`} data-reveal>
                {popular && <span className={s.flag}>Most popular</span>}
                <h3>{p.name}</h3>
                <p className={s.who}>{copy.who}</p>
                <div className={s.price}>
                  <span>{amount}</span>
                  {p.paid && <small>/month</small>}
                </div>
                <p className={s.perYear}>{billing}</p>
                <ul>
                  {copy.features.map((f) => (
                    <li key={f.label} className={f.muted ? s.mut : undefined}>
                      {f.muted ? <Cross /> : <Check />}{f.label}
                    </li>
                  ))}
                </ul>
                <a className={`${s.btn} ${popular ? s.btnTeal : s.btnGhostLight}`} href="/signup">{copy.cta}</a>
              </div>
            );
          })}
        </div>

        <p className={`${s.teaser} ${s.rv}`} data-reveal>
          <b>{CONSULTANCY_TEASER_EN_LEAD}</b>{CONSULTANCY_TEASER_EN_REST}
        </p>
      </div>
    </section>
  );
}
