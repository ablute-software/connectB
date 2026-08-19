// Prompt 266 §3 — confirm/unconfirm a community-consensus badge. Any org
// member may vote once per (consensus row, org) — voting again changes
// THIS org's own vote (upsert on the unique constraint) rather than
// stacking a second ±1, matching the prompt's own "idempotente."
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { consensusId?: string; vote?: number };
  if (!body.consensusId || (body.vote !== 1 && body.vote !== -1)) {
    return NextResponse.json({ ok: false, error: 'consensusId and vote (1 or -1) are required.' }, { status: 400 });
  }

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: consensus, error: consensusErr } = await admin.from('catalog_field_consensus').select('id, score').eq('id', body.consensusId).maybeSingle();
  if (consensusErr || !consensus) return NextResponse.json({ ok: false, error: consensusErr?.message ?? 'Not found.' }, { status: 404 });

  const { data: existingVote } = await admin.from('catalog_field_consensus_votes').select('id, vote').eq('consensus_id', body.consensusId).eq('org_id', orgId).maybeSingle();

  // Idempotent: the same vote clicked again changes nothing.
  if (existingVote && existingVote.vote === body.vote) {
    return NextResponse.json({ ok: true, score: consensus.score, yourVote: body.vote });
  }

  const delta = existingVote ? body.vote - (existingVote.vote as number) : body.vote;
  if (existingVote) {
    await admin.from('catalog_field_consensus_votes').update({ vote: body.vote, updated_at: new Date().toISOString() }).eq('id', existingVote.id);
  } else {
    await admin.from('catalog_field_consensus_votes').insert({ consensus_id: body.consensusId, org_id: orgId, vote: body.vote });
  }

  const newScore = (consensus.score as number) + delta;
  await admin.from('catalog_field_consensus').update({ score: newScore, updated_at: new Date().toISOString() }).eq('id', body.consensusId);

  return NextResponse.json({ ok: true, score: newScore, yourVote: body.vote });
}
