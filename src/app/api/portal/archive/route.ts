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
import { createArchiveEntry, getArchiveEntries } from '@/lib/investor-archive';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const [entries, investorProfile] = await Promise.all([
    getArchiveEntries(admin, user.id, email),
    resolveInvestorProfile(admin, user.id),
  ]);
  const usualCoInvestors = (investorProfile as { usual_co_investors: string | null } | null)?.usual_co_investors ?? null;
  return NextResponse.json({ entries, usualCoInvestors });
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
