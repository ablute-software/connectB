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
//
// Prompt 161 §C.2 — also runs the Pioneer badge-grant sweep. Unlike the
// monthly catalog job, no day-of-month gate: a Pioneer redemption's
// benefit_ends_at can fall on any day, and runPioneerExpiryJob is cheap and
// idempotent (skips orgs already badged), so it just runs every tick.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { monthlyDeliveryDue } from '@/lib/catalog-monthly-delivery';
import { catalogMonthlyDeliveryAvailable } from '@/lib/catalog-monthly-delivery-capability';
import { deliverMonthlyForOrg, type MonthlyDeliveryOrgRow, type MonthlyDeliveryResult } from '@/lib/catalog-monthly-delivery-server';
import { pioneerBadgeAvailable } from '@/lib/pioneer-capability';
import { runPioneerExpiryJob } from '@/lib/pioneer-server';
import { computeAndStoreOverviewSnapshot } from '@/lib/metrics-snapshot';

// Prompt 201 §3 — limiar de sinal, não de aborto.
const MONTHLY_DELIVERY_ALERT_THRESHOLD = 100;

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

  let monthlyDelivery: { ranFor: number; results: MonthlyDeliveryResult[]; totalDelivered: number } | null = null;
  if (await catalogMonthlyDeliveryAvailable()) {
    const { data: orgs } = await admin.from('orgs').select('id, plan, catalog_quota, catalog_last_monthly_delivery, is_test');
    // is_test filtrado já aqui para nem sequer iterar sobre contas de teste —
    // deliverMonthlyForOrg tem o mesmo guarda, que é o autoritativo (Prompt
    // 201 §2). Este é só para o log de baixo contar o que interessa.
    const due = ((orgs ?? []) as MonthlyDeliveryOrgRow[])
      .filter((o) => !o.is_test)
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
    // Prompt 201 §3 — defesa a mais, não substitui o tecto por org. Não
    // aborta nada: só dá sinal se o pressuposto "cada org entrega no máximo
    // o incremento do plano" alguma vez deixar de bater certo. Com os
    // travões §1+§2 a primeira corrida (1 de Setembro) deve ficar nas ~20
    // entidades; passar de 100 significa que algo mudou e ninguém reparou.
    const totalDelivered = results.reduce((sum, r) => sum + (r.delivered ?? 0), 0);
    console.log(`[automations] entrega mensal: ${results.length} orgs, ${totalDelivered} entidades`);
    if (totalDelivered > MONTHLY_DELIVERY_ALERT_THRESHOLD) {
      console.error(`[automations] ALERTA: entrega mensal devolveu ${totalDelivered} entidades (limiar ${MONTHLY_DELIVERY_ALERT_THRESHOLD}) — verificar o tecto por org`);
    }
    monthlyDelivery = { ranFor: results.length, results, totalDelivered };
  }

  let pioneerBadges: { orgsGranted: number } | null = null;
  if (await pioneerBadgeAvailable()) {
    pioneerBadges = await runPioneerExpiryJob(admin, now);
  }

  // Prompt 295 §3 — guarantees at least 1 overview snapshot/day even if no
  // developer opens /metrics that day, so History never has a gap wider
  // than 24h. The Hobby plan's 1x/day cron cap (CLAUDE.md) is exactly why
  // this can't also be the "adjust frequency to traffic" mechanism the
  // Nuno asked for — Prompt 296's popup (a developer's own manual
  // decision, session by session) is that mechanism instead.
  let metricsSnapshot: { stored: boolean } | null = null;
  try {
    metricsSnapshot = await computeAndStoreOverviewSnapshot(admin, { triggeredBy: 'daily_cron' });
  } catch (e) {
    console.error('[automations] daily metrics snapshot failed:', e);
  }

  // TODO: implement server-side automation-rules tick — see src/lib/rules.ts
  // (pure functions, ready to reuse). Unchanged scope from before this prompt.
  return NextResponse.json({
    ok: true,
    message: 'Engine tick placeholder — automation-rules tick not yet wired to the real database.',
    monthlyDelivery,
    pioneerBadges,
    metricsSnapshot,
  });
}
