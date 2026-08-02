// Investor Workspace Agenda (prompt 59) — item computation extracted out of
// the route (Prompt 83 Bloco 5) so the iCal export route can reuse the exact
// same three-source merge instead of re-deriving it — same reasoning as
// investor-pipeline.ts's CSV export reusing getPipelineWaves.
import type { SupabaseClient } from '@supabase/supabase-js';
import { eligibleOrgIds, resolveInvestorProfile } from './portal-access';

export interface AgendaItem {
  kind: 'meeting' | 'round_close' | 'follow_up';
  date: string; // ISO
  orgId: string; orgName: string; title: string;
  followupId?: string; // present only for kind==='follow_up', so it can be marked done
}

export async function getAgendaItems(
  admin: SupabaseClient, sb: SupabaseClient, userId: string, email: string,
): Promise<AgendaItem[]> {
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await eligibleOrgIds(sb, admin, userId, email, person?.id ?? null);
  if (orgIds.length === 0) return [];

  const { data: orgs } = await admin.from('orgs').select('id, name, round_target_close_date').in('id', orgIds);
  const orgById = new Map((orgs ?? []).map((o) => [o.id as string, o]));

  const items: AgendaItem[] = [];

  for (const org of orgs ?? []) {
    if (org.round_target_close_date) {
      items.push({
        kind: 'round_close', date: org.round_target_close_date as string,
        orgId: org.id as string, orgName: org.name as string,
        title: `${org.name} round closes ${new Date(org.round_target_close_date as string).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`,
      });
    }
  }

  const investorProfile = await resolveInvestorProfile(admin, userId);
  if (investorProfile) {
    const { data: proposals } = await admin.from('matchdeal_meeting_proposals')
      .select('confirmed_slot, match_id, matchdeal_matches!inner(startup_profile_id)')
      .not('confirmed_slot', 'is', null)
      .eq('matchdeal_matches.active_investor_profile_id', investorProfile.id);
    for (const p of proposals ?? []) {
      const matchRow = p.matchdeal_matches as unknown as { startup_profile_id: string };
      const { data: startupProfile } = await admin.from('matchdeal_profiles').select('membership_id').eq('id', matchRow.startup_profile_id).maybeSingle();
      const org = startupProfile ? orgById.get(startupProfile.membership_id as string) : null;
      if (org) items.push({ kind: 'meeting', date: p.confirmed_slot as string, orgId: org.id as string, orgName: org.name as string, title: `Meeting with ${org.name}` });
    }
  }

  const { data: followups } = await admin.from('investor_followups').select('id, org_id, note, remind_at')
    .eq('investor_email', email).eq('done', false).order('remind_at', { ascending: true });
  for (const f of followups ?? []) {
    const org = orgById.get(f.org_id as string);
    items.push({
      kind: 'follow_up', date: f.remind_at as string, followupId: f.id as string,
      orgId: f.org_id as string, orgName: org?.name as string ?? 'Unknown',
      title: (f.note as string | null) || `Follow up with ${org?.name ?? 'startup'}`,
    });
  }

  items.sort((a, b) => a.date.localeCompare(b.date));
  return items;
}
