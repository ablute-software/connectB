// Prompt 603 §C / Prompt 604 §A — does this signed-in FOUNDER still need to
// see the commitments page? Reads `org_members.commitments_seen` directly —
// no `terms_acceptances`, no version (604 §A: this page is advertising, not
// a contract; a boolean mark of "seen", never an acceptance record — see
// lib/commitments.ts's own header for why reusing that table was also a
// bug). Investors and platform admins never see it: it is the founder's
// relationship as the customer whose data we process.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { commitmentsGateEnabled, shouldShowCommitments } from '@/lib/commitments';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ shouldShow: false, gateEnabled: false, seen: false });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ shouldShow: false, gateEnabled: commitmentsGateEnabled(), seen: false });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: member } = await admin.from('org_members').select('org_id, commitments_seen').eq('user_id', user.id).maybeSingle();
  const seen = !!member?.commitments_seen;
  const shouldShow = shouldShowCommitments({ gateEnabled: commitmentsGateEnabled(), signedIn: true, isFounder: !!member, seen });
  return NextResponse.json({ shouldShow, gateEnabled: commitmentsGateEnabled(), seen });
}
