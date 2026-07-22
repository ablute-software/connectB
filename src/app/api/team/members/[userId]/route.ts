// Change a member's role, or remove them. Both require the actor to
// outrank the target's CURRENT role (src/lib/permissions.ts:canActOnMember)
// — an admin can't touch another admin or an owner regardless of intent.
// Runs under service role since org_members has no update/delete RLS policy
// yet (only select) — enforcement lives here in app code instead.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { canActOnMember, canAssignRole, type OrgRole } from '@/lib/permissions';

async function authorize(req: Request, targetUserId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return { error: NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 }) };

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  if (user.id === targetUserId) return { error: NextResponse.json({ ok: false, error: "You can't change your own membership here." }, { status: 400 }) };

  const { data: self } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!self) return { error: NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 }) };

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: target } = await admin.from('org_members').select('role').eq('org_id', self.org_id).eq('user_id', targetUserId).maybeSingle();
  if (!target) return { error: NextResponse.json({ ok: false, error: 'That user is not on your team.' }, { status: 404 }) };

  if (!canActOnMember(self.role as OrgRole, target.role as OrgRole)) {
    return { error: NextResponse.json({ ok: false, error: `Your role (${self.role}) can't act on a ${target.role}.` }, { status: 403 }) };
  }
  return { admin, orgId: self.org_id, actorRole: self.role as OrgRole, targetRole: target.role as OrgRole };
}

export async function PATCH(req: Request, { params }: { params: { userId: string } }) {
  const auth = await authorize(req, params.userId);
  if ('error' in auth) return auth.error;
  const { admin, orgId, actorRole } = auth;

  const { role } = await req.json() as { role?: OrgRole };
  if (!role) return NextResponse.json({ ok: false, error: 'role is required.' }, { status: 400 });
  if (!canAssignRole(actorRole, role)) {
    return NextResponse.json({ ok: false, error: `Your role (${actorRole}) can't assign ${role}.` }, { status: 403 });
  }

  if (auth.targetRole === 'owner' && role !== 'owner') {
    const { count } = await admin.from('org_members').select('user_id', { count: 'exact', head: true }).eq('org_id', orgId).eq('role', 'owner');
    if ((count ?? 0) <= 1) return NextResponse.json({ ok: false, error: 'An org needs at least one owner.' }, { status: 409 });
  }

  const { error } = await admin.from('org_members').update({ role }).eq('org_id', orgId).eq('user_id', params.userId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { userId: string } }) {
  const auth = await authorize(req, params.userId);
  if ('error' in auth) return auth.error;
  const { admin, orgId } = auth;

  if (auth.targetRole === 'owner') {
    const { count } = await admin.from('org_members').select('user_id', { count: 'exact', head: true }).eq('org_id', orgId).eq('role', 'owner');
    if ((count ?? 0) <= 1) return NextResponse.json({ ok: false, error: 'An org needs at least one owner.' }, { status: 409 });
  }

  const { error } = await admin.from('org_members').delete().eq('org_id', orgId).eq('user_id', params.userId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
