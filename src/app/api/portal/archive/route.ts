// Investor Workspace Archive (prompt 60) — the "then vs now" board plus
// reopen. GET returns one entry per active (not reopened) archive row for
// this investor, each with its First contact / Last contact snapshots
// (structured data, captured at archive time) and the shared "Now" summary
// (one per org, regenerated on founder round/profile updates — see
// startup-snapshot.ts).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { activeGrantOrgIds, resolveInvestorProfile } from '@/lib/portal-access';
import { computeBadges, createArchiveEntry } from '@/lib/investor-archive';
import type { InvestorThesis } from '@/lib/investor-match-score';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: entries } = await admin.from('investor_archive_entries')
    .select('id, org_id, source, reason_detail, archived_at, first_contact_snapshot_id, archived_snapshot_id')
    .eq('investor_email', email).is('reopened_at', null).order('archived_at', { ascending: false });
  if (!entries || entries.length === 0) return NextResponse.json({ entries: [] });

  const orgIds = [...new Set(entries.map((e) => e.org_id as string))];
  const { data: orgs } = await admin.from('orgs').select('id, name').in('id', orgIds);
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

  const snapshotIds = [...new Set(entries.flatMap((e) => [e.first_contact_snapshot_id, e.archived_snapshot_id] as string[]))];
  const { data: snapshots } = await admin.from('startup_profile_snapshots').select('id, data, captured_at').in('id', snapshotIds);
  const snapshotById = new Map((snapshots ?? []).map((s) => [s.id as string, s]));

  const { data: nowSummaries } = await admin.from('startup_now_summaries').select('org_id, summary_text, generated_at').in('org_id', orgIds);
  const nowByOrg = new Map((nowSummaries ?? []).map((s) => [s.org_id as string, s]));

  const investorProfile = await resolveInvestorProfile(admin, user.id);
  const thesis: InvestorThesis | null = investorProfile ? {
    sectors: investorProfile.sectors ?? [], stagesInvested: investorProfile.stages_invested ?? [],
    geographies: investorProfile.geographies ?? [], instruments: investorProfile.instruments ?? [],
    ticketMin: investorProfile.ticket_min, ticketMax: investorProfile.ticket_max,
  } : null;

  const result = await Promise.all(entries.map(async (e) => {
    const firstContact = snapshotById.get(e.first_contact_snapshot_id as string);
    const lastContact = snapshotById.get(e.archived_snapshot_id as string);
    const now = nowByOrg.get(e.org_id as string);
    const badges = lastContact ? await computeBadges(admin, e.org_id as string, lastContact.data as Record<string, unknown>, thesis) : null;
    return {
      id: e.id, orgId: e.org_id, orgName: orgNameById.get(e.org_id as string) ?? 'Unknown',
      source: e.source, reasonDetail: e.reason_detail, archivedAt: e.archived_at,
      firstContact: firstContact ? { data: firstContact.data, capturedAt: firstContact.captured_at } : null,
      lastContact: lastContact ? { data: lastContact.data, capturedAt: lastContact.captured_at } : null,
      now: now ? { text: now.summary_text, generatedAt: now.generated_at } : null,
      badges,
    };
  }));

  return NextResponse.json({ entries: result });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true, qa: true });

  const body = await req.json().catch(() => ({})) as { entryId?: string; archiveOrgId?: string; reason?: string };

  // Manual archive (Prompt 60 bullet 1's other trigger, alongside pass) —
  // no swipe involved, just an archive entry.
  if (body.archiveOrgId) {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
    const orgIds = await activeGrantOrgIds(admin, email, person?.id ?? null);
    if (!orgIds.includes(body.archiveOrgId)) return NextResponse.json({ ok: false, error: 'No active access to this org.' }, { status: 403 });
    const { error } = await createArchiveEntry(admin, body.archiveOrgId, email, 'manual', body.reason ?? null);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    // Same swipe graph a pass writes to (see /api/portal/pipeline) — Pipeline's
    // card status derives from matchdeal_swipes, so a manual archive has to
    // land there too or the card would keep showing as open.
    const investorProfile = await resolveInvestorProfile(admin, user.id);
    if (investorProfile) {
      const { data: startupProfile } = await admin.from('matchdeal_profiles').select('id').eq('kind', 'startup').eq('membership_id', body.archiveOrgId).maybeSingle();
      if (startupProfile) {
        await admin.from('matchdeal_swipes').upsert(
          { actor_profile_id: investorProfile.id, target_profile_id: startupProfile.id, direction: 'pass', pass_reason: 'other' },
          { onConflict: 'actor_profile_id,target_profile_id' },
        );
      }
    }

    return NextResponse.json({ ok: true });
  }

  if (!body.entryId) return NextResponse.json({ ok: false, error: 'entryId or archiveOrgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: entry } = await admin.from('investor_archive_entries').select('id, org_id')
    .eq('id', body.entryId).eq('investor_email', email).is('reopened_at', null).maybeSingle();
  if (!entry) return NextResponse.json({ ok: false, error: 'Archive entry not found.' }, { status: 404 });

  // Reopen: mark this archive entry closed (its own row stays forever —
  // "histórico contínuo") and clear the pass swipe so Pipeline shows the
  // card as open again.
  const { error: reopenError } = await admin.from('investor_archive_entries').update({ reopened_at: new Date().toISOString() }).eq('id', entry.id);
  if (reopenError) return NextResponse.json({ ok: false, error: reopenError.message }, { status: 500 });

  const investorProfile = await resolveInvestorProfile(admin, user.id);
  if (investorProfile) {
    const { data: startupProfile } = await admin.from('matchdeal_profiles').select('id').eq('kind', 'startup').eq('membership_id', entry.org_id).maybeSingle();
    if (startupProfile) {
      await admin.from('matchdeal_swipes').delete()
        .eq('actor_profile_id', investorProfile.id).eq('target_profile_id', startupProfile.id).eq('direction', 'pass');
    }
  }

  return NextResponse.json({ ok: true });
}
