// Creates a team invitation. Moved server-side (was a direct client insert
// in TeamCard) so the actor's rank can be enforced beyond what RLS alone
// checks: org_invitations' RLS only requires the actor be owner/admin, not
// that the *assigned* role stays below their own — an admin inviting
// someone as 'owner' would otherwise slip through. See src/lib/permissions.ts.
import { NextResponse } from 'next/server';
import { serverClient, getOrgRole } from '@/lib/supabase-server';
import { canAssignRole, type OrgRole } from '@/lib/permissions';

export async function POST(req: Request) {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { orgId, email, role } = await req.json() as { orgId?: string; email?: string; role?: OrgRole };
  if (!orgId || !email || !role) return NextResponse.json({ ok: false, error: 'orgId, email, and role are required.' }, { status: 400 });

  const actorRole = await getOrgRole(user.id, sb);
  if (!actorRole || !canAssignRole(actorRole, role)) {
    return NextResponse.json({ ok: false, error: `Your role (${actorRole ?? 'none'}) can't invite someone as ${role}.` }, { status: 403 });
  }

  const { data, error } = await sb.from('org_invitations').insert({ org_id: orgId, email, role }).select('token').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, token: data.token });
}
