// Prompt 603 §C — does this signed-in FOUNDER need to see the commitments
// page? Mirrors /api/terms/status; the decision is shouldGateCommitments.
// Investors and platform admins never see it (it is the founder's
// relationship as the customer whose data we process).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { COMMITMENTS_VERSION, commitmentsGateEnabled, isCommitmentsVersion, shouldGateCommitments } from '@/lib/commitments';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ needsAcceptance: false, gateEnabled: false, version: COMMITMENTS_VERSION });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ needsAcceptance: false, gateEnabled: commitmentsGateEnabled(), version: COMMITMENTS_VERSION });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const [{ data: member }, { data: rows }] = await Promise.all([
    admin.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle(),
    admin.from('terms_acceptances').select('version, accepted_at').eq('user_id', user.id).order('accepted_at', { ascending: false }),
  ]);
  const accepted = (rows ?? []).map((r) => r.version as string).find(isCommitmentsVersion) ?? null;
  const needsAcceptance = shouldGateCommitments({
    gateEnabled: commitmentsGateEnabled(), signedIn: true, isFounder: !!member, acceptedVersion: accepted,
  });
  return NextResponse.json({ needsAcceptance, gateEnabled: commitmentsGateEnabled(), version: COMMITMENTS_VERSION, acceptedVersion: accepted });
}
