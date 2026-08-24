// Prompt 349 — Chamber 2 landing: founder reads insights investors chose,
// item by item, to share. Identified by investor name — never anonymous —
// same posture as investor_feedback_shares itself.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ shares: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ shares: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data } = await admin.from('investor_feedback_shares').select('id, investor_name, kind, text, shared_at')
    .eq('org_id', member.org_id as string).order('shared_at', { ascending: false });
  return NextResponse.json({ shares: data ?? [] });
}
