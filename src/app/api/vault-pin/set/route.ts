// Prompt 118 §3.5 / tail verification — owner sets a member's Vault PIN.
// vault_pin_set_for_user's own security-definer check enforces "owner only"
// against the real caller (session-scoped client, not service role).
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: Request) {
  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { orgId, userId, pin } = await req.json().catch(() => ({})) as { orgId?: string; userId?: string; pin?: string };
  if (!orgId || !userId || !pin) return NextResponse.json({ ok: false, error: 'orgId, userId, and pin are required.' }, { status: 400 });
  if (!/^\d{4}$/.test(pin)) return NextResponse.json({ ok: false, error: 'Code must be exactly 4 digits.' }, { status: 400 });

  const { error } = await sb.rpc('vault_pin_set_for_user', { p_org_id: orgId, p_user_id: userId, p_pin: pin });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
