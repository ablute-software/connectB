// Investor Workspace Agenda (prompt 59) — three sources merged into one
// timeline, no parallel meetings system: meetings reuse matchdeal's own
// matchdeal_meeting_proposals (the mobile pairing/swipe flow already
// produces these), round-close deadlines read straight off
// orgs.round_target_close_date, and manual follow-ups are the one genuinely
// new thing (migration 0060).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { eligibleOrgIds, resolveInvestorProfile } from '@/lib/portal-access';

interface AgendaItem {
  kind: 'meeting' | 'round_close' | 'follow_up';
  date: string; // ISO
  orgId: string; orgName: string; title: string;
  followupId?: string; // present only for kind==='follow_up', so it can be marked done
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
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await eligibleOrgIds(sb, admin, user.id, email, person?.id ?? null);
  if (orgIds.length === 0) return NextResponse.json({ items: [] });

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

  // Meetings — via this investor's matchdeal profile, if linked. A QA
  // session (never linked to a real matchdeal_investor_members row) simply
  // contributes zero meetings here, same non-contamination principle as
  // everywhere else in the portal.
  const investorProfile = await resolveInvestorProfile(admin, user.id);
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
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { orgId?: string; note?: string; remindAt?: string };
  if (!body.orgId || !body.remindAt) return NextResponse.json({ ok: false, error: 'orgId and remindAt are required.' }, { status: 400 });

  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true, qa: true });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await eligibleOrgIds(sb, admin, user.id, email, person?.id ?? null);
  if (!orgIds.includes(body.orgId)) return NextResponse.json({ ok: false, error: 'No active access to this org.' }, { status: 403 });

  const { error } = await admin.from('investor_followups').insert({
    org_id: body.orgId, investor_email: email, note: body.note ?? null, remind_at: body.remindAt,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true, qa: true });

  const body = await req.json().catch(() => ({})) as { id?: string };
  if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // investor_email match here IS the ownership check (this table has no
  // other RLS access for investors — see migration 0060's header) — a
  // service-role update without it would let any signed-in investor mark
  // any other investor's follow-up done.
  const { error } = await admin.from('investor_followups').update({ done: true }).eq('id', body.id).eq('investor_email', email);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
