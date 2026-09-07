// Prompt 602 §B — the owner's switch ("allow an admin to start a reset of my
// password", off by default) and what an admin can see: which owners allow
// it. Plus the caller's own security history (who/when/from where).
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { serviceAdmin, userEmail } from '@/lib/account-security-server';
import { SECURITY_EVENT_LABEL, type SecurityEventKind } from '@/lib/account-security';

export async function GET() {
  const admin = serviceAdmin();
  if (!admin) return NextResponse.json({ ok: true, available: false });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: self, error } = await admin.from('org_members').select('org_id, role, allow_admin_password_reset').eq('user_id', user.id).maybeSingle();
  if (error) return NextResponse.json({ ok: true, available: false, error: error.message });
  if (!self) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  // Admins see the owners who opted in; owners see nothing here (they reset their own the normal way).
  let resettableOwners: { userId: string; email: string }[] = [];
  if (self.role === 'admin') {
    const { data: owners } = await admin.from('org_members').select('user_id').eq('org_id', self.org_id).eq('role', 'owner').eq('allow_admin_password_reset', true);
    for (const o of owners ?? []) {
      const email = await userEmail(admin, o.user_id as string);
      if (email) resettableOwners.push({ userId: o.user_id as string, email });
    }
  }

  const { data: events } = await admin.from('account_security_events')
    .select('id, kind, ip, user_agent, created_at, actor_user_id, detail')
    .eq('user_id', user.id).order('created_at', { ascending: false }).limit(10);

  return NextResponse.json({
    ok: true, available: true, myRole: self.role, allowAdminPasswordReset: !!self.allow_admin_password_reset,
    resettableOwners,
    events: (events ?? []).map((e) => ({
      id: e.id, kind: e.kind, label: SECURITY_EVENT_LABEL[e.kind as SecurityEventKind] ?? e.kind,
      ip: e.ip, userAgent: e.user_agent, at: e.created_at, byMe: e.actor_user_id === user.id, detail: e.detail,
    })),
  });
}

export async function PATCH(req: Request) {
  const admin = serviceAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Not available in this workspace.' }, { status: 200 });
  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { allowAdminPasswordReset } = await req.json().catch(() => ({})) as { allowAdminPasswordReset?: boolean };
  if (typeof allowAdminPasswordReset !== 'boolean') return NextResponse.json({ ok: false, error: 'allowAdminPasswordReset must be true or false.' }, { status: 400 });

  const { data: self } = await admin.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!self) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  if (self.role !== 'owner') return NextResponse.json({ ok: false, error: 'Only an owner can set this on their own account.' }, { status: 403 });

  const { error } = await admin.from('org_members').update({ allow_admin_password_reset: allowAdminPasswordReset })
    .eq('org_id', self.org_id).eq('user_id', user.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, allowAdminPasswordReset });
}
