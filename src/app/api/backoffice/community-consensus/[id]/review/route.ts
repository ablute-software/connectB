// Prompt 266 §6 — manual developer override for one catalog_field_consensus
// row: 'approve' sets score=2 (the same baseline the engine itself uses the
// first time 2 sources agree — §2), making it visible to founders as
// "community · unconfirmed" immediately, even off a single source or a
// disagreement the AI arbiter never resolved. 'reject' sets score=-1
// (<=0 — hidden), the same threshold a run of real downvotes would reach.
// Never deletes the row or its sources/votes — same append-only rule as
// everywhere else in this schema.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';

async function adminGate(): Promise<{ admin: SupabaseClient } | { error: NextResponse }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return { error: NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 }) };

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  const role = await resolveRole(user.id, user.email, sb, user.email_confirmed_at);
  if (role !== 'developer') return { error: NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 }) };

  return { admin: createClient(url, service, { auth: { persistSession: false } }) };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await adminGate();
  if ('error' in gate) return gate.error;
  const { admin } = gate;

  const body = await req.json().catch(() => ({})) as { decision?: 'approve' | 'reject' };
  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return NextResponse.json({ ok: false, error: 'decision must be approve or reject.' }, { status: 400 });
  }

  const score = body.decision === 'approve' ? 2 : -1;
  const { error } = await admin.from('catalog_field_consensus').update({ score, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, score });
}
