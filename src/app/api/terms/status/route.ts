// Prompt 341 §B — does this signed-in user need to see the acceptance
// gate? Demo mode (no Supabase configured) never gates: there is no real
// user account to record an acceptance against.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { TERMS_VERSION, shouldGateTerms } from '@/lib/terms';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseConfigured = !!url && !!serviceKey;
  if (!supabaseConfigured) return NextResponse.json({ needsAcceptance: false });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ needsAcceptance: false });

  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  // Any accepted row for this user, regardless of version — shouldGateTerms
  // itself decides whether it matches the CURRENT version.
  const { data } = await admin.from('terms_acceptances').select('version')
    .eq('user_id', user.id).order('accepted_at', { ascending: false }).limit(1).maybeSingle();

  const needsAcceptance = shouldGateTerms({ supabaseConfigured, signedIn: true, acceptedVersion: (data?.version as string | undefined) ?? null });
  return NextResponse.json({ needsAcceptance, version: TERMS_VERSION });
}
