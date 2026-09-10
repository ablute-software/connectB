// Prompt 877 — Backoffice "Data": Ficha do cliente list. One customer list
// spanning both structurally different customer concepts this schema has —
// `orgs` (the startup/founder tenant) and `catalog_entities` +
// `investor_billing` (the investor side, with "registered account" defined
// the same way /api/backoffice/investor-accounts already does: a real
// active matchdeal_investor_members seat, not merely a catalog row). Every
// row carries `kind: 'org' | 'investor_entity'`, the same discriminator
// ViewerEntryName.tsx already uses for this exact two-schema situation —
// confirmed current by reading that component before reusing its values.
//
// Read-only throughout. Archived (derived, not stored — same discipline as
// Prompt 876's isOutreachArchived) is returned per row, same as that
// prompt's own GET route; the client picks Active/Arquivo, this route
// doesn't take a query param for it.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { investorOrgRows } from '@/lib/backoffice-metrics';
import { isRegisteredInvestorAccount } from '@/lib/investor-account-filter';
import { planLabelForSlug, normalizePlan, investorPlanRow, MATCHDEAL_TIER_TO_INVESTOR_PLAN } from '@/lib/plans';
import { isRedemptionCurrentlyActive } from '@/lib/promo';
import { derivePaymentBucket, isCustomerOverdue, isCustomerArchived, type PaymentBucket } from '@/lib/customer-filter';

export interface CustomerRow {
  kind: 'org' | 'investor_entity';
  id: string;
  name: string;
  category: 'Startup' | 'VC';
  signupDate: string | null;
  plan: string;
  nextPaymentDueAt: string | null;
  /** Most recent billing_invoices row for this subject, if any — the
   *  "last payment date" the list's own date-range filter runs against. */
  lastPaymentAt: string | null;
  lastPaymentStatus: 'paid' | 'failed' | 'none' | null;
  paymentBucket: PaymentBucket;
  isOverdue: boolean;
  isArchived: boolean;
}

function investorPlanLabel(tierCode: string | null): string {
  if (!tierCode) return '—';
  const investorTier = MATCHDEAL_TIER_TO_INVESTOR_PLAN[tierCode];
  return investorTier ? investorPlanRow(investorTier).name : tierCode;
}

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  const now = new Date();

  // ---------- Startups (orgs) ----------
  // is_test/is_internal excluded — this is a CUSTOMER list, not an admin
  // ops table; ablute_'s own team org and every verification fixture are
  // neither.
  const { data: orgs } = await admin.from('orgs')
    .select('id, name, plan, created_at, next_payment_due_at, last_payment_status, moderation_status, closed_at')
    .eq('is_test', false).eq('is_internal', false);

  const orgIds = (orgs ?? []).map((o) => o.id as string);
  const [{ data: redemptions }, { data: orgInvoices }] = await Promise.all([
    orgIds.length
      ? admin.from('promo_redemptions').select('org_id, benefit_ends_at, promo_codes(deleted_at)').in('org_id', orgIds)
      : Promise.resolve({ data: [] as { org_id: string; benefit_ends_at: string | null; promo_codes: { deleted_at: string | null } | null }[] }),
    orgIds.length
      ? admin.from('billing_invoices').select('org_id, created_at').eq('kind', 'org').in('org_id', orgIds)
      : Promise.resolve({ data: [] as { org_id: string; created_at: string }[] }),
  ]);

  const activePromoByOrg = new Set<string>();
  for (const r of redemptions ?? []) {
    const promo = r.promo_codes as unknown as { deleted_at: string | null } | null;
    if (isRedemptionCurrentlyActive(promo, r.benefit_ends_at as string | null, now)) activePromoByOrg.add(r.org_id as string);
  }
  const lastInvoiceByOrg = new Map<string, string>();
  for (const inv of orgInvoices ?? []) {
    const oid = inv.org_id as string;
    const createdAt = inv.created_at as string;
    if (!lastInvoiceByOrg.has(oid) || createdAt > lastInvoiceByOrg.get(oid)!) lastInvoiceByOrg.set(oid, createdAt);
  }

  const orgRows: CustomerRow[] = (orgs ?? []).map((o) => {
    const lastPaymentStatus = (o.last_payment_status as 'paid' | 'failed' | 'none' | null) ?? null;
    const hasActivePromo = activePromoByOrg.has(o.id as string);
    const nextPaymentDueAt = o.next_payment_due_at as string | null;
    return {
      kind: 'org', id: o.id as string, name: o.name as string, category: 'Startup',
      signupDate: o.created_at as string,
      plan: planLabelForSlug(normalizePlan(o.plan as string)),
      nextPaymentDueAt, lastPaymentAt: lastInvoiceByOrg.get(o.id as string) ?? null, lastPaymentStatus,
      paymentBucket: derivePaymentBucket({ lastPaymentStatus, hasActivePromo }),
      isOverdue: isCustomerOverdue(nextPaymentDueAt, lastPaymentStatus, now),
      isArchived: isCustomerArchived({
        accountDeleted: o.moderation_status === 'deleted' || !!o.closed_at,
        lastPaymentStatus, lastBillingSignalAt: lastInvoiceByOrg.get(o.id as string) ?? null, now,
      }),
    };
  });

  // ---------- Investors (catalog_entities, via the established "registered
  // account" definition — a real matchdeal_investor_members seat) ----------
  const allInvestorRows = await investorOrgRows(admin);
  const registered = allInvestorRows.filter((r) => isRegisteredInvestorAccount(r.seatsLinked) && !r.isInternal);
  const investorEntityIds = registered.map((r) => r.entityId);

  const [{ data: catalogFlags }, { data: members }, { data: billing }, { data: invInvoices }] = await Promise.all([
    investorEntityIds.length
      ? admin.from('catalog_entities').select('id, is_test, moderation_status').in('id', investorEntityIds)
      : Promise.resolve({ data: [] as { id: string; is_test: boolean; moderation_status: string | null }[] }),
    investorEntityIds.length
      ? admin.from('matchdeal_investor_members').select('catalog_entity_id, created_at').eq('status', 'active').in('catalog_entity_id', investorEntityIds)
      : Promise.resolve({ data: [] as { catalog_entity_id: string; created_at: string }[] }),
    investorEntityIds.length
      ? admin.from('investor_billing').select('catalog_entity_id, plan_tier, created_at, next_payment_due_at, last_payment_status').in('catalog_entity_id', investorEntityIds)
      : Promise.resolve({ data: [] as { catalog_entity_id: string; plan_tier: string | null; created_at: string; next_payment_due_at: string | null; last_payment_status: string | null }[] }),
    investorEntityIds.length
      ? admin.from('billing_invoices').select('catalog_entity_id, created_at').eq('kind', 'investor_entity').in('catalog_entity_id', investorEntityIds)
      : Promise.resolve({ data: [] as { catalog_entity_id: string; created_at: string }[] }),
  ]);

  const isTestByEntity = new Map((catalogFlags ?? []).map((c) => [c.id as string, !!c.is_test]));
  const moderationByEntity = new Map((catalogFlags ?? []).map((c) => [c.id as string, c.moderation_status as string | null]));
  const earliestSeatByEntity = new Map<string, string>();
  for (const m of members ?? []) {
    const eid = m.catalog_entity_id as string;
    const createdAt = m.created_at as string;
    if (!earliestSeatByEntity.has(eid) || createdAt < earliestSeatByEntity.get(eid)!) earliestSeatByEntity.set(eid, createdAt);
  }
  const billingByEntity = new Map((billing ?? []).map((b) => [b.catalog_entity_id as string, b]));
  const lastInvoiceByEntity = new Map<string, string>();
  for (const inv of invInvoices ?? []) {
    const eid = inv.catalog_entity_id as string;
    const createdAt = inv.created_at as string;
    if (!lastInvoiceByEntity.has(eid) || createdAt > lastInvoiceByEntity.get(eid)!) lastInvoiceByEntity.set(eid, createdAt);
  }

  const investorRows: CustomerRow[] = registered
    .filter((r) => !isTestByEntity.get(r.entityId))
    .map((r) => {
      const b = billingByEntity.get(r.entityId);
      const lastPaymentStatus = (b?.last_payment_status as 'paid' | 'failed' | 'none' | null) ?? null;
      const nextPaymentDueAt = b?.next_payment_due_at ?? null;
      // Prompt 877 — signup date sourced from the earliest ACTIVE seat, not
      // investor_billing.created_at (that table has zero rows in
      // production today — see this migration's own header comment — and
      // this IS how /api/backoffice/investor-accounts already defines a
      // "registered investor account"). investor_billing.created_at is
      // only the fallback for a firm with billing history but somehow no
      // active seat on record, a state that shouldn't currently exist.
      const signupDate = earliestSeatByEntity.get(r.entityId) ?? b?.created_at ?? null;
      // Promo codes are startup-only in this schema — promo_redemptions.
      // org_id is NOT NULL, nothing in Prompt 854/876's outreach system
      // targets an investor firm — so an investor row can never land in
      // the "promo" bucket.
      return {
        kind: 'investor_entity' as const, id: r.entityId, name: r.name, category: 'VC' as const,
        signupDate,
        plan: investorPlanLabel(b?.plan_tier ?? r.planTier),
        nextPaymentDueAt, lastPaymentAt: lastInvoiceByEntity.get(r.entityId) ?? null, lastPaymentStatus,
        paymentBucket: derivePaymentBucket({ lastPaymentStatus, hasActivePromo: false }),
        isOverdue: isCustomerOverdue(nextPaymentDueAt, lastPaymentStatus, now),
        isArchived: isCustomerArchived({
          accountDeleted: moderationByEntity.get(r.entityId) === 'deleted',
          lastPaymentStatus, lastBillingSignalAt: lastInvoiceByEntity.get(r.entityId) ?? null, now,
        }),
      };
    });

  return NextResponse.json({ ok: true, customers: [...orgRows, ...investorRows] });
}
