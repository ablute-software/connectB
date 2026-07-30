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
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { computeMatchScore, type InvestorThesis, type StartupRound } from '@/lib/investor-match-score';

const WAVE_SIZE = 8;
const PASS_REASONS = ['ticket_too_small', 'outside_thesis', 'too_early', 'other'] as const;

async function resolveInvestorProfile(admin: SupabaseClient, userId: string) {
  const { data: member } = await admin.from('matchdeal_investor_members').select('id')
    .eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (!member) return null;
  const { data: profile } = await admin.from('matchdeal_profiles').select('id, sectors, stages_invested, geographies, instruments, ticket_min, ticket_max')
    .eq('membership_id', member.id).eq('kind', 'investor').maybeSingle();
  return profile ?? null;
}

async function activeGrantOrgIds(admin: SupabaseClient, email: string, personId: string | null) {
  const orParts = [`grantee_email.eq.${email}`, `invited_email.eq.${email}`];
  if (personId) orParts.push(`person_id.eq.${personId}`);
  const { data: grants } = await admin.from('access_grants').select('org_id, confirmed_at, invited_email, revoked_at, expires_at')
    .is('revoked_at', null).or(orParts.join(','));
  const now = new Date();
  const ids = new Set<string>();
  for (const g of grants ?? []) {
    const notExpired = !g.expires_at || new Date(g.expires_at as string) > now;
    const confirmedIfInvited = !g.invited_email || g.confirmed_at;
    if (notExpired && confirmedIfInvited) ids.add(g.org_id as string);
  }
  return [...ids];
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const investorProfile = await resolveInvestorProfile(admin, user.id);
  if (!investorProfile) return NextResponse.json({ linked: false });

  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await activeGrantOrgIds(admin, email, person?.id ?? null);
  if (orgIds.length === 0) return NextResponse.json({ linked: true, waves: [] });

  const { data: orgs } = await admin.from('orgs').select(
    'id, name, one_liner, sectors, stage, round_target_eur, round_min_ticket_eur, round_instruments, hq_city, country',
  ).in('id', orgIds);
  const { data: startupProfiles } = await admin.from('matchdeal_profiles').select('id, membership_id')
    .eq('kind', 'startup').in('membership_id', orgIds);
  const profileByOrg = new Map((startupProfiles ?? []).map((p) => [p.membership_id as string, p.id as string]));

  const thesis: InvestorThesis = {
    sectors: investorProfile.sectors ?? [], stagesInvested: investorProfile.stages_invested ?? [],
    geographies: investorProfile.geographies ?? [], instruments: investorProfile.instruments ?? [],
    ticketMin: investorProfile.ticket_min, ticketMax: investorProfile.ticket_max,
  };

  const startupProfileIds = [...profileByOrg.values()];
  const { data: swipes } = startupProfileIds.length
    ? await admin.from('matchdeal_swipes').select('target_profile_id, direction, pass_reason')
      .eq('actor_profile_id', investorProfile.id).in('target_profile_id', startupProfileIds)
    : { data: [] as { target_profile_id: string; direction: string; pass_reason: string | null }[] };
  const swipeByStartupProfile = new Map((swipes ?? []).map((s) => [s.target_profile_id as string, s]));

  const cards = (orgs ?? []).map((org) => {
    const round: StartupRound = {
      sectors: org.sectors ?? [], stage: org.stage, country: org.country,
      roundTargetEur: org.round_target_eur, roundMinTicketEur: org.round_min_ticket_eur,
      roundInstruments: org.round_instruments ?? [],
    };
    const { score, reasons } = computeMatchScore(thesis, round);
    const startupProfileId = profileByOrg.get(org.id as string) ?? null;
    const swipe = startupProfileId ? swipeByStartupProfile.get(startupProfileId) : null;
    const status = swipe?.direction === 'pass' ? 'passed' : swipe?.direction === 'like' ? 'interested' : 'open';
    return {
      orgId: org.id, name: org.name, oneLiner: org.one_liner, sectors: org.sectors ?? [], stage: org.stage,
      hqCity: org.hq_city, country: org.country, roundTargetEur: org.round_target_eur,
      roundInstruments: org.round_instruments ?? [], matchScore: score, matchReasons: reasons,
      status, passReason: swipe?.pass_reason ?? null,
    };
  }).sort((a, b) => b.matchScore - a.matchScore);

  const waves = [];
  for (let i = 0; i < cards.length; i += WAVE_SIZE) {
    const items = cards.slice(i, i + WAVE_SIZE);
    const priorTreated = cards.slice(0, i).every((c) => c.status !== 'open');
    waves.push({ index: waves.length, items, unlocked: i === 0 || priorTreated });
  }

  return NextResponse.json({ linked: true, waves });
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
  }

  return NextResponse.json({ ok: true });
}
