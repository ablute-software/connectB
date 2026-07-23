// Creates a team invitation. Moved server-side (was a direct client insert
// in TeamCard) so the actor's rank can be enforced beyond what RLS alone
// checks: org_invitations' RLS only requires the actor be owner/admin, not
// that the *assigned* role stays below their own — an admin inviting
// someone as 'owner' would otherwise slip through. See src/lib/permissions.ts.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, getOrgRole } from '@/lib/supabase-server';
import { canAssignRole, type OrgRole } from '@/lib/permissions';
import { loadOrgMatrix } from '@/lib/org-matrix-server';
import { canWithMatrix } from '@/lib/org-permissions';

export async function POST(req: Request) {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { orgId, email, role } = await req.json() as { orgId?: string; email?: string; role?: OrgRole };
  if (!orgId || !email || !role) return NextResponse.json({ ok: false, error: 'orgId, email, and role are required.' }, { status: 400 });

  const actorRole = await getOrgRole(user.id, sb);
  // Two gates: the org's configured matrix decides who may invite AT ALL
  // (batch 3 C), and canAssignRole decides which roles they may assign.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && service) {
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const matrix = await loadOrgMatrix(admin, orgId);
    if (!canWithMatrix(matrix, actorRole, 'invites')) {
      return NextResponse.json({ ok: false, error: 'Your role can’t invite teammates.' }, { status: 403 });
    }
  }
  if (!actorRole || !canAssignRole(actorRole, role)) {
    return NextResponse.json({ ok: false, error: `Your role (${actorRole ?? 'none'}) can't invite someone as ${role}.` }, { status: 403 });
  }

  const { data, error } = await sb.from('org_invitations').insert({ org_id: orgId, email, role }).select('token').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, token: data.token });
}
