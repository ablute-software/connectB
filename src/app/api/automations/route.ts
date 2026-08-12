// Automation engine tick — production entry point (Vercel cron).
// vercel.json schedules: { "crons": [{ "path": "/api/automations", "schedule": "0 9 * * *" }] }
// (Vercel Hobby plan allows only 1x/day — this fires daily but the
// automation-rules tick below and the monthly catalog delivery job each
// decide independently whether there's anything to actually do today.)
//
// In demo mode the automation-rules tick runs client-side (store.runAutomationTick).
// Server-side rule evaluation (src/lib/rules.ts) is not yet wired to this route —
// unchanged from before this prompt, still a placeholder.
//
// Prompt 179 §B — this route now ALSO runs the monthly catalog-quota-growth
// job (previously entirely unbuilt — see plans.ts's own "not yet built"
// comment on PLAN_PIPELINE_MONTHLY_ADDITION). Piggybacked here rather than a
// second cron entry specifically because of the Hobby-plan 1x/day cron
// limit named in the prompt.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { monthlyDeliveryDue } from '@/lib/catalog-monthly-delivery';
import { catalogMonthlyDeliveryAvailable } from '@/lib/catalog-monthly-delivery-capability';
import { deliverMonthlyForOrg, type MonthlyDeliveryOrgRow, type MonthlyDeliveryResult } from '@/lib/catalog-monthly-delivery-server';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) {
    return NextResponse.json({
      ok: false,
      message: 'Database not configured — engine runs in demo mode (client-side tick from the Outbox page).',
    });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const now = new Date().toISOString();

  let monthlyDelivery: { ranFor: number; results: MonthlyDeliveryResult[] } | null = null;
  if (await catalogMonthlyDeliveryAvailable()) {
    const { data: orgs } = await admin.from('orgs').select('id, plan, catalog_quota, catalog_last_monthly_delivery');
    const due = ((orgs ?? []) as MonthlyDeliveryOrgRow[])
      .filter((o) => monthlyDeliveryDue(o.catalog_last_monthly_delivery, now));
    const results: MonthlyDeliveryResult[] = [];
    for (const org of due) {
      // Sequential, not Promise.all — this writes money-equivalent state
      // (catalog_quota) org-by-org; today's org count is small (early-stage
      // product) and a serverless-function timeout mid-batch should only
      // ever strand orgs not yet reached (each org's own update is atomic),
      // never leave one half-applied.
      results.push(await deliverMonthlyForOrg(admin, org, now));
    }
    monthlyDelivery = { ranFor: results.length, results };
  }

  // TODO: implement server-side automation-rules tick — see src/lib/rules.ts
  // (pure functions, ready to reuse). Unchanged scope from before this prompt.
  return NextResponse.json({
    ok: true,
    message: 'Engine tick placeholder — automation-rules tick not yet wired to the real database.',
    monthlyDelivery,
  });
}
