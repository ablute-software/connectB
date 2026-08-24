// Prompt 340 Block D — the Messages tab's own thread list, across every
// startup, distinct from /api/portal/messages (one org at a time, used by
// the per-startup dossier's Messages sub-tab and by this same tab's own
// thread view once a row is opened).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { getMessageThreadsForInvestor } from '@/lib/investor-messages';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ threads: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ threads: [] });

  const threads = await getMessageThreadsForInvestor(admin, investorCatalogEntityId);
  return NextResponse.json({ threads });
}
