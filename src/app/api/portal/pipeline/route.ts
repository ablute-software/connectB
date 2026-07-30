// Investor Workspace Pipeline (prompt 58) — startups presented gradually by
// thesis match, in waves, mirroring the founder-side pipeline's own
// doseamento principle. Eligible startups = orgs this investor already has
// an active access_grants row for (same trust boundary as every other
// portal route — today that's just ablute_, so bullet 6 of the prompt
// ["com só a ablute_, mostra 1 card"] falls out of the existing grant model
// for free, no separate "which startups can this investor see" concept).
//
// Signals write into matchdeal_swipes (the SAME investor<->startup graph
// MatchDeal's swipe deck uses — see migration 0057's header) via a plain
// upsert, not the matchdeal_record_swipe() RPC: that RPC's weekly like-cap
// and mutual-match/consent/dataroom-grant machinery belongs to the
// swipe-deck product, not a curated Pipeline where dataroom access already
// comes from access_grants. "Express interest" additionally writes an
// investor_ticket_signals row (Prompt 54/56's existing mechanism) so the
// founder sees it exactly where ticket signals already surface.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { activeGrantOrgIds, resolveInvestorProfile } from '@/lib/portal-access';
import { createArchiveEntry } from '@/lib/investor-archive';
import { getPipelineWaves } from '@/lib/investor-pipeline';

const PASS_REASONS = ['ticket_too_small', 'outside_thesis', 'too_early', 'other'] as const;

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const result = await getPipelineWaves(sb, admin, user.id, email);
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { orgId?: string; action?: 'pass' | 'interest'; reason?: string };
  const { orgId, action, reason } = body;
  if (!orgId || (action !== 'pass' && action !== 'interest')) {
    return NextResponse.json({ ok: false, error: 'orgId and a valid action are required.' }, { status: 400 });
  }
  if (action === 'pass' && !PASS_REASONS.includes(reason as typeof PASS_REASONS[number])) {
    return NextResponse.json({ ok: false, error: 'A pass reason is required.' }, { status: 400 });
  }

  // Same non-contamination principle as every other portal write route:
  // @ablute.pt QA sessions can exercise the UI but never write a real
  // signal or swipe.
  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true, qa: true });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const investorProfile = await resolveInvestorProfile(admin, user.id);
  if (!investorProfile) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await activeGrantOrgIds(admin, email, person?.id ?? null);
  if (!orgIds.includes(orgId)) return NextResponse.json({ ok: false, error: 'No active access to this org.' }, { status: 403 });

  const { data: startupProfile } = await admin.from('matchdeal_profiles').select('id')
    .eq('kind', 'startup').eq('membership_id', orgId).maybeSingle();
  if (!startupProfile) return NextResponse.json({ ok: false, error: 'This startup is not on the matching graph yet.' }, { status: 409 });

  const { error: swipeError } = await admin.from('matchdeal_swipes').upsert({
    actor_profile_id: investorProfile.id, target_profile_id: startupProfile.id,
    direction: action === 'pass' ? 'pass' : 'like',
    pass_reason: action === 'pass' ? reason : null,
  }, { onConflict: 'actor_profile_id,target_profile_id' });
  if (swipeError) return NextResponse.json({ ok: false, error: swipeError.message }, { status: 500 });

  if (action === 'interest') {
    const { ticket_min, ticket_max } = investorProfile as { ticket_min: number | null; ticket_max: number | null };
    await admin.from('investor_ticket_signals').insert({
      org_id: orgId, person_id: person?.id ?? null, investor_email: email,
      range_min_eur: ticket_min, range_max_eur: ticket_max, range_label: 'Interested via Pipeline',
    });
  } else {
    // A pass automatically archives (Prompt 60 bullet 1) — the startup
    // isn't discarded, it's deal flow the investor can reopen later with
    // full history intact.
    await createArchiveEntry(admin, orgId, email, 'pass', reason ?? null);
  }

  return NextResponse.json({ ok: true });
}
