// Prompt 118 §3.5 / tail verification — owner reads the whole org's Vault
// PIN state (has_pin/required/locked_until per member, never the code
// itself). Calls vault_pin_list via the session-scoped client (not the
// service role) so its own security-definer "role = 'owner'" check runs
// against the real caller — a service-role client has no auth.uid(), so
// this can't be bypassed by switching clients.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';

export async function GET(req: Request) {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });

  const { data, error } = await sb.rpc('vault_pin_list', { p_org_id: orgId });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
  return NextResponse.json({
    ok: true,
    members: (data ?? []).map((r: { user_id: string; has_pin: boolean; required: boolean; locked_until: string | null }) => ({
      userId: r.user_id, hasPin: r.has_pin, required: r.required, lockedUntil: r.locked_until,
    })),
  });
}
