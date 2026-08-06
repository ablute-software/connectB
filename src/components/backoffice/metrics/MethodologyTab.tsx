'use client';
// Prompt 124 Block A (§2.3) — versions, definitions, what changed. Static
// content is deliberate here (this documents adopted decisions, not live
// data) — updated by hand whenever a metric's definition changes, same
// spirit as DECISIONS.md for code.
import { Card } from '@/components/ui';

export function MethodologyTab() {
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">v0 — 2026-08-04. What each number on this dashboard actually means, and what changed since the last version.</p>

      <Card title="Ecosystem privacy: K-anonymity">
        <p className="text-sm text-gray-600">
          Every Ecosystem/X-Ray query is withheld unless the cohort has at least <b>8 distinct organizations</b> AND
          no single organization accounts for more than <b>50%</b> of the rows (migration 0116&apos;s <code>observatory_query</code>,
          mirrored in <code>/api/backoffice/metrics/ecosystem</code>). This is why a small or org-dominated cohort shows
          &quot;withheld&quot; instead of a number that would effectively identify one company.
        </p>
      </Card>

      <Card title="MRR / Net New MRR">
        <p className="text-sm text-gray-600">
          <b>Fixed (Prompt 124 C6).</b> MRR previously required <code>orgs.stripe_subscription_id</code> to count an
          org as paying — but the platform team&apos;s manual plan flip (no live billing wiring yet) never sets that
          column, while Net New MRR reads <code>plan_changed</code> events written by a database trigger on any
          <code>orgs.plan</code> update, Stripe or not. That mismatch is what produced €0 MRR next to €64 Net New MRR
          with 2 paying orgs on screen. <b>Adopted definition:</b> both now read <code>orgs.plan</code> directly — an
          org is &quot;paying&quot; whenever its plan tier isn&apos;t the free tier, regardless of billing mechanism. Annual
          plans are recognized at their monthly-equivalent; an active promo discount reduces the list price for MRR
          (not for Net New MRR&apos;s event-based delta, a smaller documented simplification — see the two functions&apos;
          own code comments).
        </p>
      </Card>

      <Card title="New investors: catalog entities vs. registered accounts">
        <p className="text-sm text-gray-600">
          &quot;Catalog entities added&quot; counts every investor profile imported or enriched into the catalog — most were
          never touched by a real signed-up user. &quot;Investor accounts registered&quot; counts only firms with at least one
          active <code>matchdeal_investor_members</code> seat — a real person who actually signed in. The Overview tab
          shows both as separate cards (Prompt 124 M9/C7) specifically so the catalog number is never mistaken for
          real adoption.
        </p>
      </Card>

      <Card title="Organization dominance (app floor)">
        <p className="text-sm text-gray-600">
          Platform-wide totals on the &quot;Sherlock Deal &amp; app&quot; floor can be dominated by a single org (today,
          ablute_&apos;s imported CRM data is most of the fundraising-outcomes funnel). Rows/charts affected by this are
          marked, and &quot;results by startup&quot; is shown first rather than only an aggregate — inspired by, but a lighter
          rule than, the Ecosystem floor&apos;s own K-anonymity/dominance gate (that gate is about privacy; this one is
          about not mistaking one company&apos;s activity for the platform&apos;s).
        </p>
      </Card>

      <Card title="Sensors this dashboard depends on">
        <p className="text-sm text-gray-600">
          acquisition_source, page_view, document_view, the 7 investor-source categories, and append-only stage
          transitions (Prompt 124 C1–C5) are what let several numbers here move from estimate to measured. Sample &amp;
          coverage tracks their rollout as a % of accounts/grants/relations actually instrumented.
        </p>
      </Card>
    </div>
  );
}
