// Prompt 349 — Chamber 2 landing: founder reads insights investors chose,
// item by item, to share. Identified by investor name — never anonymous —
// same posture as investor_feedback_shares itself.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveViewedOrgId } from '@/lib/developer-viewer';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ shares: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  // Prompt 902 — the viewed org in a Developer Viewer session, the caller's own otherwise.
  const orgId = await resolveViewedOrgId(sb, req, user.id);
  if (!orgId) return NextResponse.json({ shares: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data } = await admin.from('investor_feedback_shares').select('id, investor_name, kind, text, shared_at')
    .eq('org_id', orgId).order('shared_at', { ascending: false });
  return NextResponse.json({ shares: data ?? [] });
}
