// Prompt I-01 §A.8/§C.2 — accept, for the signed-in founder's own open org.
// The relationship is created by incubator_accept_invite() under the
// caller's session, which checks (I-01b) that the caller's address is the
// invited one and that they are an owner/admin of that org; the voucher, if
// any, is redeemed afterwards and never undoes the relationship.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireProgramManager } from '@/lib/incubator-founder-gate';
import { acceptIncubatorInvite, type AcceptRpcResult } from '@/lib/incubator-accept';
import { redeemIncubatorInviteVoucher } from '@/lib/incubator-voucher-server';

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const gate = await requireProgramManager(req, { allowNoOrg: true });
  if ('error' in gate) return gate.error;
  const { sb, userId } = gate;

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
      return redeemIncubatorInviteVoucher(admin, promoCodeId, orgId, userId);
    },
  });
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 400 });
}
