// Prompt 107 — owner-controlled Visible/Suspended toggle. Never writes
// is_visible or platform_suspended_at — is_visible is now a computed
// value (see migration 0105's matchdeal_recompute_profile_completeness
// trigger); platform_suspended_at has no UI yet, reserved for a future
// backoffice action.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';

type Kind = 'startup' | 'investor';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const kind = new URL(req.url).searchParams.get('kind') as Kind | null;
  if (kind !== 'startup' && kind !== 'investor') return NextResponse.json({ ok: false, error: 'kind must be startup or investor.' }, { status: 400 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  if (kind === 'startup') {
    const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
    if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
    const { data: profile } = await admin.from('matchdeal_profiles')
      .select('owner_suspended_at, platform_suspended_at, suspension_reminded_at')
      .eq('membership_id', member.org_id).eq('kind', 'startup').maybeSingle();
    return NextResponse.json({
      ok: true, isOwner: member.role === 'owner',
      suspended: !!profile?.owner_suspended_at, platformSuspended: !!profile?.platform_suspended_at,
      suspendedAt: profile?.owner_suspended_at ?? null, remindedAt: profile?.suspension_reminded_at ?? null,
    });
  }

  const activeMember = await resolveActiveInvestorMember(admin, user.id);
  if (!activeMember) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });
  const { data: mim } = await admin.from('matchdeal_investor_members').select('role').eq('id', activeMember.id).maybeSingle();
  const { data: profile } = await admin.from('matchdeal_profiles')
    .select('owner_suspended_at, platform_suspended_at, suspension_reminded_at')
    .eq('membership_id', activeMember.id).eq('kind', 'investor').maybeSingle();
  return NextResponse.json({
    ok: true, isOwner: mim?.role === 'owner',
    suspended: !!profile?.owner_suspended_at, platformSuspended: !!profile?.platform_suspended_at,
    suspendedAt: profile?.owner_suspended_at ?? null, remindedAt: profile?.suspension_reminded_at ?? null,
  });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { suspended, kind, markReminded } = await req.json().catch(() => ({})) as { suspended?: boolean; kind?: Kind; markReminded?: boolean };
  if (kind !== 'startup' && kind !== 'investor') return NextResponse.json({ ok: false, error: 'kind must be startup or investor.' }, { status: 400 });
  if (typeof suspended !== 'boolean' && !markReminded) return NextResponse.json({ ok: false, error: 'suspended must be a boolean.' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  // markReminded is its own no-owner-check path — any member dismissing
  // the monthly reminder they were shown just silences it for everyone
  // until the next cycle, same as any other "seen this" acknowledgment;
  // it never touches owner_suspended_at.
  const patch = markReminded
    ? { suspension_reminded_at: new Date().toISOString() }
    : { owner_suspended_at: suspended ? new Date().toISOString() : null };

  if (kind === 'startup') {
    const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
    if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
    if (member.role !== 'owner') return NextResponse.json({ ok: false, error: 'Only the owner can change visibility.' }, { status: 403 });
    // upsert, not update — an org that never touched MatchDeal has no
    // matchdeal_profiles row yet (confirmed live: a real test org had
    // zero rows), and a plain .update() on zero matching rows silently
    // "succeeds" while changing nothing.
    const { error } = await admin.from('matchdeal_profiles')
      .upsert({ membership_id: member.org_id, kind: 'startup', ...patch }, { onConflict: 'membership_id,kind' });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const activeMember = await resolveActiveInvestorMember(admin, user.id);
  if (!activeMember) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });
  const { data: mim } = await admin.from('matchdeal_investor_members').select('role').eq('id', activeMember.id).maybeSingle();
  if (mim?.role !== 'owner') return NextResponse.json({ ok: false, error: 'Only the owner can change visibility.' }, { status: 403 });
  const { error } = await admin.from('matchdeal_profiles')
    .upsert({ membership_id: activeMember.id, kind: 'investor', ...patch }, { onConflict: 'membership_id,kind' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
