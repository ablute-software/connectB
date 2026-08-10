// Prompt 156 — investor side of "confirm before unlock" (migration 0156).
// Mirrors the startup side's unlockPack(): a single explicit action the
// investor takes once their profile crosses the completeness gate, before
// the Pipeline (already-computed live by getPipelineWaves) is shown to
// them. Idempotent — a second call is a no-op if already confirmed, same
// "unlocked, stays unlocked" semantics as the startup side.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  const { data: existing } = await admin.from('matchdeal_investor_members')
    .select('pipeline_confirmed_at').eq('id', member.id).maybeSingle();
  if (existing?.pipeline_confirmed_at) {
    return NextResponse.json({ ok: true, pipelineConfirmedAt: existing.pipeline_confirmed_at as string });
  }

  const now = new Date().toISOString();
  const { error } = await admin.from('matchdeal_investor_members').update({ pipeline_confirmed_at: now }).eq('id', member.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, pipelineConfirmedAt: now });
}
