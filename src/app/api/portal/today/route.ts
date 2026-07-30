// Investor Workspace Today (prompt 59) — mirrors the founder-side Today's
// shape (generated, not hand-written, most-urgent-first cards) but nothing
// at the function level is shared: TodayPanel.tsx runs entirely off the
// founder's single-org client store (db.tasks/db.entities), while the
// investor's Today spans MULTIPLE startups through service-role portal
// routes — a different data-access domain, not just different data. What's
// shared is the pattern (Card-per-signal-type, most-urgent-first), not code.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { computeMatchScore, type InvestorThesis, type StartupRound } from '@/lib/investor-match-score';
import { eligibleOrgIds, resolveInvestorProfile } from '@/lib/portal-access';

const WAVE_SIZE = 8;
const ANSWERED_RECENTLY_DAYS = 7;
const ROUND_CLOSING_SOON_DAYS = 30;

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await eligibleOrgIds(sb, admin, user.id, email, person?.id ?? null);
  const now = new Date();

  const items: { kind: string; title: string; orgId?: string }[] = [];

  // 1. New matches in the active (first unlocked) wave — same eligibility +
  // scoring as the Pipeline tab; a card counts as "new" while it's still
  // untouched (no pass/interest swipe yet), which for wave 1 is always the
  // active wave.
  const investorProfile = await resolveInvestorProfile(admin, user.id);
  if (investorProfile && orgIds.length > 0) {
    const { data: orgs } = await admin.from('orgs').select(
      'id, sectors, stage, country, round_target_eur, round_min_ticket_eur, round_instruments',
    ).in('id', orgIds);
    const { data: startupProfiles } = await admin.from('matchdeal_profiles').select('id, membership_id').eq('kind', 'startup').in('membership_id', orgIds);
    const profileByOrg = new Map((startupProfiles ?? []).map((p) => [p.membership_id as string, p.id as string]));
    const startupProfileIds = [...profileByOrg.values()];
    const { data: swipes } = startupProfileIds.length
      ? await admin.from('matchdeal_swipes').select('target_profile_id, direction').eq('actor_profile_id', investorProfile.id).in('target_profile_id', startupProfileIds)
      : { data: [] as { target_profile_id: string; direction: string }[] };
    const swipedIds = new Set((swipes ?? []).map((s) => s.target_profile_id as string));
    const thesis: InvestorThesis = {
      sectors: investorProfile.sectors ?? [], stagesInvested: investorProfile.stages_invested ?? [],
      geographies: investorProfile.geographies ?? [], instruments: investorProfile.instruments ?? [],
      ticketMin: investorProfile.ticket_min, ticketMax: investorProfile.ticket_max,
    };
    const scored = (orgs ?? []).map((org) => {
      const round: StartupRound = {
        sectors: org.sectors ?? [], stage: org.stage, country: org.country,
        roundTargetEur: org.round_target_eur, roundMinTicketEur: org.round_min_ticket_eur, roundInstruments: org.round_instruments ?? [],
      };
      return { orgId: org.id as string, score: computeMatchScore(thesis, round).score, open: !swipedIds.has(profileByOrg.get(org.id as string) ?? '') };
    }).sort((a, b) => b.score - a.score);
    const wave1New = scored.slice(0, WAVE_SIZE).filter((c) => c.open).length;
    if (wave1New > 0) items.push({ kind: 'new_matches', title: `${wave1New} new match${wave1New === 1 ? '' : 'es'} in your Wave 1` });
  }

  // 2. Q&A answers received recently, on this investor's own questions.
  const { data: answered } = await admin.from('portal_questions').select('org_id, question, answered_at')
    .eq('asked_by_email', email).not('answered_at', 'is', null)
    .gte('answered_at', new Date(now.getTime() - ANSWERED_RECENTLY_DAYS * 86400000).toISOString());
  const orgNameCache = new Map<string, string>();
  async function orgName(orgId: string) {
    if (orgNameCache.has(orgId)) return orgNameCache.get(orgId)!;
    const { data } = await admin.from('orgs').select('name').eq('id', orgId).maybeSingle();
    const name = (data?.name as string | undefined) ?? 'Startup';
    orgNameCache.set(orgId, name);
    return name;
  }
  for (const q of answered ?? []) {
    items.push({ kind: 'qa_answered', orgId: q.org_id as string, title: `${await orgName(q.org_id as string)} answered your question` });
  }

  // 3. Meetings today.
  if (investorProfile) {
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
    const { data: proposals } = await admin.from('matchdeal_meeting_proposals')
      .select('confirmed_slot, matchdeal_matches!inner(startup_profile_id)')
      .gte('confirmed_slot', startOfDay.toISOString()).lte('confirmed_slot', endOfDay.toISOString())
      .eq('matchdeal_matches.active_investor_profile_id', investorProfile.id);
    for (const p of proposals ?? []) {
      const matchRow = p.matchdeal_matches as unknown as { startup_profile_id: string };
      const { data: startupProfile } = await admin.from('matchdeal_profiles').select('membership_id').eq('id', matchRow.startup_profile_id).maybeSingle();
      if (startupProfile) items.push({ kind: 'meeting_today', orgId: startupProfile.membership_id as string, title: `Meeting today with ${await orgName(startupProfile.membership_id as string)}` });
    }
  }

  // 4. Rounds closing soon, for startups this investor expressed interest in.
  if (investorProfile && orgIds.length > 0) {
    const { data: startupProfiles } = await admin.from('matchdeal_profiles').select('id, membership_id').eq('kind', 'startup').in('membership_id', orgIds);
    const profileByOrg = new Map((startupProfiles ?? []).map((p) => [p.membership_id as string, p.id as string]));
    const startupProfileIds = [...profileByOrg.values()];
    const { data: likes } = startupProfileIds.length
      ? await admin.from('matchdeal_swipes').select('target_profile_id').eq('actor_profile_id', investorProfile.id).eq('direction', 'like').in('target_profile_id', startupProfileIds)
      : { data: [] as { target_profile_id: string }[] };
    const likedProfileIds = new Set((likes ?? []).map((l) => l.target_profile_id as string));
    const likedOrgIds = orgIds.filter((id) => likedProfileIds.has(profileByOrg.get(id) ?? ''));
    if (likedOrgIds.length > 0) {
      const { data: orgs } = await admin.from('orgs').select('id, name, round_target_close_date').in('id', likedOrgIds);
      for (const org of orgs ?? []) {
        if (!org.round_target_close_date) continue;
        const closeDate = new Date(org.round_target_close_date as string);
        const daysUntil = Math.round((closeDate.getTime() - now.getTime()) / 86400000);
        if (daysUntil >= 0 && daysUntil <= ROUND_CLOSING_SOON_DAYS) {
          const weeks = Math.round(daysUntil / 7);
          items.push({ kind: 'round_closing', orgId: org.id as string, title: `${org.name} round closes in ${weeks} week${weeks === 1 ? '' : 's'} — you expressed interest` });
        }
      }
    }
  }

  // 5. Overdue follow-ups.
  const { data: overdueFollowups } = await admin.from('investor_followups').select('org_id, note, remind_at')
    .eq('investor_email', email).eq('done', false).lt('remind_at', now.toISOString());
  for (const f of overdueFollowups ?? []) {
    items.push({ kind: 'followup_overdue', orgId: f.org_id as string, title: (f.note as string | null) || `Follow up with ${await orgName(f.org_id as string)} is overdue` });
  }

  return NextResponse.json({ items });
}
