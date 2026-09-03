'use client';
// Prompt 548 Part 4 — Plans & billing is real, not frosted.
//
// Every other guest entry shows the shape of a tool behind glass, because
// there is nothing a guest is entitled to see there. Pricing is the
// opposite: it is public information, it is exactly what someone deciding
// whether to open an account needs, and blurring it would be theatre.
//
// Prompt 550 — this used to render InvestorPricingSection, the LANDING page's
// pricing block, and what a guest actually got was a headline, a toggle, and
// nothing underneath.
//
// Those cards carry landing.module.css's `.rv`, which is
// `opacity: 0; transform: translateY(26px)` until something sets
// `[data-in='true']`. The only thing that ever sets it is LandingEffects, an
// IntersectionObserver mounted by /app/page.tsx and /app/investors/page.tsx
// and by nothing else. Inside the workspace shell there is no LandingEffects,
// so the cards stayed at opacity 0 permanently. The header and toggle showed
// because they carry data-reveal WITHOUT `.rv` — which is exactly why the page
// looked half-built rather than blank.
//
// 548 verified it by reading prices out of the DOM. The DOM had them; the
// screen did not. A text assertion cannot see opacity. That is why this now
// shares the WORKSPACE grid (InvestorPlanGrid) instead of a landing section:
// nothing it renders depends on which page mounted it.
//
// Fully usable up to the point of buying. No Stripe call is made from here;
// "Choose {plan}" goes to the existing signup flow, carrying the guest token
// so the share can be reconnected to the new account later.
import { useState } from 'react';
import Link from 'next/link';
import { InvestorPlanGrid, type BillingMode } from '@/components/investor-workspace/InvestorPlanGrid';
import { previewSignupHref } from '@/lib/guest-previews';

export function GuestPlansPreview({ token, orgName }: { token?: string; orgName?: string | null }) {
  const [billing, setBilling] = useState<BillingMode>('monthly');

  return (
    <div className="space-y-4">
      {/* Stands where the signed-in panel shows the current-plan card. A guest
          has no plan, so this says what they are instead. The org clause is
          omitted when there is no name to use — including the token-less
          route, which has no share to stay connected to. */}
      <p className="rounded-lg border border-cyan-100 bg-[#E8F4F8]/60 px-3 py-2 text-xs text-gray-700">
        You&apos;re browsing as a guest. Pick a plan, create your account
        {orgName ? <>, and your share from <span className="font-medium">{orgName}</span> stays connected</> : null}.
      </p>

      <InvestorPlanGrid
        billing={billing}
        onBillingChange={setBilling}
        // A guest has no current plan, so no card is highlighted.
        current={null}
        renderCta={(p) => (
          <Link href={previewSignupHref('plans', token)}
            className="block w-full rounded-lg bg-[#0E7490] px-3 py-1.5 text-center text-xs font-semibold text-white transition hover:bg-[#0c637b]">
            Choose {p.name}
          </Link>
        )}
      />

      <p className="text-[11px] text-gray-400">
        No payment is taken here — you choose and pay after creating your account.
      </p>
    </div>
  );
}
