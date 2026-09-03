// Prompt 548 Part 4 — Plans & billing is real, not frosted.
//
// Every other guest entry shows the shape of a tool behind glass, because
// there is nothing a guest is entitled to see there. Pricing is the
// opposite: it is public information, it is exactly what someone deciding
// whether to open an account needs, and blurring it would be theatre.
//
// It reuses InvestorPricingSection — the landing page's own pricing block,
// which reads INVESTOR_PLANS / INVESTOR_PLAN_FOOTNOTES, owns the
// Monthly/Annual toggle and renders PrivateDetectiveCard. Verified before
// choosing it: it makes no fetch, touches no store and needs no session.
// InvestorPlansPanel — the authenticated one — is deliberately NOT used: it
// calls /api/portal/investor-profile and would 401 for a guest.
//
// Fully usable up to the point of buying. No Stripe call is made from here;
// "Choose plan" goes to the existing signup flow, carrying the guest token
// so the share can be reconnected to the new account later.
import { InvestorPricingSection } from '@/components/landing/InvestorPricingSection';
import { previewSignupHref } from '@/lib/guest-previews';

export function GuestPlansPreview({ token }: { token?: string }) {
  return (
    <div className="-mx-6">
      <InvestorPricingSection signupHref={previewSignupHref('plans', token)} ctaLabel="Choose plan" />
    </div>
  );
}
