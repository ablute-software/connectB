// Prompt 749 — "os créditos de IA mostrados no card vêm sempre do valor
// guardado no backoffice, lidos no servidor a cada visita à página... sem
// unstable_cache longo... sem fallback para uma constante." Public
// (unauthenticated — both the signed-in Plans & billing page and the
// anonymous landing page read this) so it can't reuse requirePlatformAdmin;
// service-role read is the only way to see the plans table's real numbers,
// same pattern plan-server.ts already uses for other cross-boundary reads
// (badgeFreeTier/bestFreeTrialTier). No caching (no unstable_cache,
// no revalidate export) — every request re-reads Postgres. On any failure
// the affected tier is simply omitted (not backfilled from a guessed
// constant); the card renders "AI credits included" with no number for it.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PLAN_TIERS } from '@/lib/plans';
import type { PlanTier } from '@/lib/types';

// Nothing here calls a Next dynamic function (no cookies()/headers(), unlike
// /api/me's route — which is why THAT route's build-output "○ Static" symbol
// is safe despite looking alarming: cookies() inside serverClient() forces
// per-request rendering regardless of the printed symbol). This route calls
// none of those, so without this export Next's Route Handler static
// evaluation would be free to cache the response at build time via the Full
// Route Cache — exactly the "unstable_cache-shaped" staleness the prompt
// explicitly rules out. Forced dynamic here, matching the existing
// force-dynamic precedent on other explicitly-uncached routes in this app
// (portal/access-log, guest/[token], platform-badges).
export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const credits: Partial<Record<PlanTier, number>> = {};
  if (!url || !service) return NextResponse.json({ ok: true, credits });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data } = await admin.from('plans').select('key, monthly_ai_credits').in('key', PLAN_TIERS);
  for (const row of data ?? []) {
    const key = row.key as string;
    if ((PLAN_TIERS as string[]).includes(key) && typeof row.monthly_ai_credits === 'number') {
      credits[key as PlanTier] = row.monthly_ai_credits;
    }
  }
  return NextResponse.json({ ok: true, credits });
}
