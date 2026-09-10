// Prompt 877 — Ficha do cliente detail: signup date, contracted plan,
// description, every billing_invoices row (Stripe links), and — startups
// only — the redeemed outreach promo code, if any. Read-only.
//
// Flagged deviation from the prompt's own description, stated once here
// rather than silently narrowed: the prompt describes the promo-code
// section as also showing "attachments" and "recipient-email lock state".
// Both are Prompt 876 additions (promo_outreach_attachments,
// promo_outreach_targets.recipient_email) that live only on branch
// claude/prompt-876-outreach-form-attachments — NOT on main, and this
// branch (877) was built on top of 875/main, not on top of 876. Until 876
// lands, those columns/tables don't exist for this route to read. This
// route shows everything 0343's schema actually has today (target name,
// category, offer terms, status, the code itself); once 876 merges, the
// attachments/lock fields are a straight addition here, not a rewrite.
//
// VC → portfolio-company cross-reference: confirmed not buildable. The only
// two candidate paths (0201's investor_investments/market_companies, which
// links a VC to a third-party research library with no org_id; and 0246's
// org_competitors, which links the OPPOSITE direction, a startup declaring
// a competitor) do not connect a VC to the org_ids of startups in its
// portfolio that are also our own customers. No such section is rendered.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { planLabelForSlug, normalizePlan, investorPlanRow, MATCHDEAL_TIER_TO_INVESTOR_PLAN } from '@/lib/plans';

function investorPlanLabel(tierCode: string | null): string {
  if (!tierCode) return '—';
  const investorTier = MATCHDEAL_TIER_TO_INVESTOR_PLAN[tierCode];
  return investorTier ? investorPlanRow(investorTier).name : tierCode;
}

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  const { kind, id } = await params;

  if (kind !== 'org' && kind !== 'investor_entity') {
    return NextResponse.json({ ok: false, error: 'Unknown customer kind.' }, { status: 400 });
  }

  if (kind === 'org') {
    const { data: org, error } = await admin.from('orgs')
      .select('id, name, plan, created_at, description, next_payment_due_at, last_payment_status')
      .eq('id', id).maybeSingle();
    if (error || !org) return NextResponse.json({ ok: false, error: 'Customer not found.' }, { status: 404 });

    const { data: invoices } = await admin.from('billing_invoices')
      .select('id, stripe_invoice_id, amount_due_cents, amount_paid_cents, currency, status, due_date, paid_at, hosted_invoice_url, created_at')
      .eq('kind', 'org').eq('org_id', id).order('created_at', { ascending: false });

    // The redeemed promo code (if any) and the outreach target it came
    // from — promo_redemptions.org_id is unique per (promo_code_id, org_id)
    // but an org could in principle have redeemed more than one code over
    // time (different promos), so this reads all of them, newest first.
    const { data: redemptions } = await admin.from('promo_redemptions')
      .select('promo_code_id, redeemed_at, benefit_ends_at, promo_codes(code, label, kind, discount_pct)')
      .eq('org_id', id).order('redeemed_at', { ascending: false });

    const promoCodeIds = (redemptions ?? []).map((r) => r.promo_code_id as string);
    const { data: outreachTargets } = promoCodeIds.length
      ? await admin.from('promo_outreach_targets').select('promo_code_id, name, category, status').in('promo_code_id', promoCodeIds)
      : { data: [] as { promo_code_id: string; name: string; category: string; status: string }[] };
    const targetByCode = new Map((outreachTargets ?? []).map((t) => [t.promo_code_id as string, t]));

    return NextResponse.json({
      ok: true,
      customer: {
        kind: 'org', id: org.id, name: org.name,
        signupDate: org.created_at,
        plan: planLabelForSlug(normalizePlan(org.plan)),
        description: org.description ?? null,
        nextPaymentDueAt: org.next_payment_due_at,
        lastPaymentStatus: org.last_payment_status,
        invoices: invoices ?? [],
        redemptions: (redemptions ?? []).map((r) => {
          const promo = r.promo_codes as unknown as { code: string; label: string | null; kind: string; discount_pct: number } | null;
          const target = targetByCode.get(r.promo_code_id as string) ?? null;
          return {
            code: promo?.code ?? null, label: promo?.label ?? null, discountPct: promo?.discount_pct ?? null,
            redeemedAt: r.redeemed_at, benefitEndsAt: r.benefit_ends_at,
            outreachTarget: target ? { name: target.name, category: target.category, status: target.status } : null,
          };
        }),
      },
    });
  }

  // ---------- investor_entity ----------
  const { data: entity, error } = await admin.from('catalog_entities')
    .select('id, name, thesis, notes')
    .eq('id', id).maybeSingle();
  if (error || !entity) return NextResponse.json({ ok: false, error: 'Customer not found.' }, { status: 404 });

  const [{ data: seats }, { data: billing }, { data: invoices }] = await Promise.all([
    admin.from('matchdeal_investor_members').select('created_at').eq('catalog_entity_id', id).eq('status', 'active').order('created_at', { ascending: true }).limit(1),
    admin.from('investor_billing').select('plan_tier, created_at, next_payment_due_at, last_payment_status').eq('catalog_entity_id', id).maybeSingle(),
    admin.from('billing_invoices').select('id, stripe_invoice_id, amount_due_cents, amount_paid_cents, currency, status, due_date, paid_at, hosted_invoice_url, created_at')
      .eq('kind', 'investor_entity').eq('catalog_entity_id', id).order('created_at', { ascending: false }),
  ]);

  const signupDate = seats?.[0]?.created_at ?? billing?.created_at ?? null;

  return NextResponse.json({
    ok: true,
    customer: {
      kind: 'investor_entity', id: entity.id, name: entity.name,
      signupDate,
      plan: investorPlanLabel(billing?.plan_tier ?? null),
      description: entity.thesis ?? entity.notes ?? null,
      nextPaymentDueAt: billing?.next_payment_due_at ?? null,
      lastPaymentStatus: billing?.last_payment_status ?? null,
      invoices: invoices ?? [],
      // VC-portfolio cross-reference: not buildable (see file header) —
      // deliberately absent rather than an empty/guessed list.
      portfolioNotBuildableReason: 'No schema path connects this firm to the org_ids of startups in its portfolio that are also our own customers.',
    },
  });
}
