// Prompt 706 Bloco D — read-only wallet status for ONE action, for the
// pre-spend confirmation popup ("you've used Y of Z this month") and any
// other client surface that wants to show remaining credits before the
// founder commits to an action. Never charges — chargeAiAction (called
// inside the actual action's own route once the founder confirms) is the
// only thing that spends a credit.
import { NextResponse, type NextRequest } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { aiWalletStatus, aiWalletStatusForViewer } from '@/lib/ai-credits';
import { actingReader, withActingOrg, resolveActingOrg } from '@/lib/acting-org';

export const GET = withActingOrg(async function GET(req: NextRequest) {
  const actionKey = req.nextUrl.searchParams.get('action');
  if (!actionKey) return NextResponse.json({ ok: false, error: 'Missing action.' }, { status: 400 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const acting = await resolveActingOrg(req, user, sb);
  if (!acting.orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  // Prompt 904 — a viewer session shows the VIEWED org's wallet and never touches it: ai_wallet_status()
  // refuses a non-member and rolls the period over (a write) as a side effect, so the viewer reads a
  // read-only replica of the same numbers.
  const status = acting.mode === 'viewer'
    ? await aiWalletStatusForViewer(actingReader(acting, sb), acting.orgId as string, actionKey)
    : await aiWalletStatus(sb, acting.orgId as string, actionKey);
  if (!status) return NextResponse.json({ ok: false, error: 'Could not read wallet status.' });

  return NextResponse.json({ ok: true, status });
});
