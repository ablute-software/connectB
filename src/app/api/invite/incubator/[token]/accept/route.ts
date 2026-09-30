// Prompt I-01 §A.8/§C.2 — accept, for the signed-in founder's own open org.
// The relationship is created by incubator_accept_invite() under the
// caller's session (it checks the org itself); the voucher, if any, is
// redeemed afterwards and never undoes the relationship.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { acceptIncubatorInvite, type AcceptRpcResult } from '@/lib/incubator-accept';
import { redeemIncubatorInviteVoucher } from '@/lib/incubator-voucher-server';

export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (!authEnabled) return NextResponse.json({ ok: false, demo: true, error: 'not configured' });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_signed_in' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const outcome = await acceptIncubatorInvite(params.token, {
    acceptRpc: async (token) => {
      const { data, error } = await sb.rpc('incubator_accept_invite', { p_token: token });
      if (error) return { ok: false, error: 'unknown' };
      return data as AcceptRpcResult;
    },
    redeemVoucher: async (promoCodeId, orgId) => {
      if (!service) return { ok: false, reason: 'not_configured' };
      const admin = createClient(url, service, { auth: { persistSession: false } });
      return redeemIncubatorInviteVoucher(admin, promoCodeId, orgId, user.id);
    },
  });
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 400 });
}
