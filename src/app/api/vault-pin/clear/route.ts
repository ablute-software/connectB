// Prompt 118 §3.5 / tail verification — owner clears a member's Vault PIN
// (the empty-field state). vault_pin_clear_for_user's own security-definer
// check enforces "owner only" against the real caller.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: Request) {
  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { orgId, userId } = await req.json().catch(() => ({})) as { orgId?: string; userId?: string };
  if (!orgId || !userId) return NextResponse.json({ ok: false, error: 'orgId and userId are required.' }, { status: 400 });

  const { error } = await sb.rpc('vault_pin_clear_for_user', { p_org_id: orgId, p_user_id: userId });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
  return NextResponse.json({ ok: true });
}
