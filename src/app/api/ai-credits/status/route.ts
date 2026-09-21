// Prompt 706 Bloco D — read-only wallet status for ONE action, for the
// pre-spend confirmation popup ("you've used Y of Z this month") and any
// other client surface that wants to show remaining credits before the
// founder commits to an action. Never charges — chargeAiAction (called
// inside the actual action's own route once the founder confirms) is the
// only thing that spends a credit.
import { NextResponse, type NextRequest } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { aiWalletStatus } from '@/lib/ai-credits';

export async function GET(req: NextRequest) {
  const actionKey = req.nextUrl.searchParams.get('action');
  if (!actionKey) return NextResponse.json({ ok: false, error: 'Missing action.' }, { status: 400 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const status = await aiWalletStatus(sb, member.org_id as string, actionKey);
  if (!status) return NextResponse.json({ ok: false, error: 'Could not read wallet status.' });

  return NextResponse.json({ ok: true, status });
}
