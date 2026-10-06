// Investor firms this founder may START a new Sherlock messaging thread
// with. Addenda 2026-08-05 §1 originally restricted this to an active
// MatchDeal match — Prompt 197 A corrects that: it was more restrictive
// than "investor demonstrated interest," which desynced this list (and the
// POST gate below) from what the founder's own Pipeline already shows as a
// real relationship. Now founderMessageEligibleFirms (deal-messages.ts) —
// the same symmetric criterion as canInvestorMessage, not a duplicated
// rule. Firms that already have a thread are excluded — the founder replies
// to those from the existing thread view, not "starts" them again.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { dealMessagesAvailable } from '@/lib/deal-messages-capability';
import { founderMessageEligibleFirms } from '@/lib/deal-messages';
import { resolveViewedOrgId } from '@/lib/developer-viewer';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ firms: [] }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await dealMessagesAvailable())) return NextResponse.json({ firms: [] });

  // Prompt 902 — the viewed org in a Developer Viewer session, the caller's own otherwise.
  const orgId = await resolveViewedOrgId(sb, req, user.id);
  if (!orgId) return NextResponse.json({ firms: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const eligible = await founderMessageEligibleFirms(admin, orgId);
  if (eligible.length === 0) return NextResponse.json({ firms: [] });

  const { data: existingThreads } = await admin.from('deal_threads').select('investor_catalog_entity_id').eq('startup_org_id', orgId);
  const alreadyThreaded = new Set((existingThreads ?? []).map((t) => t.investor_catalog_entity_id as string));
  const startable = eligible.filter((f) => !alreadyThreaded.has(f.investorCatalogEntityId));

  return NextResponse.json({
    firms: startable.map((f) => ({ investorCatalogEntityId: f.investorCatalogEntityId, name: f.name })),
  });
}
