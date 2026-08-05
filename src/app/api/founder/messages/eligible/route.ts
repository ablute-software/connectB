// Addenda 2026-08-05 §1 — investor firms this founder may START a new
// Sherlock messaging thread with: those with an active MatchDeal match
// against this startup (see matchdeal-active-match.ts for the exact
// definition). Firms that already have a thread are excluded — the founder
// replies to those from the existing thread view, not "starts" them again.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { dealMessagesAvailable } from '@/lib/deal-messages-capability';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ firms: [] }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await dealMessagesAvailable())) return NextResponse.json({ firms: [] });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ firms: [] });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: startupProfile } = await admin.from('matchdeal_profiles').select('id').eq('kind', 'startup').eq('membership_id', orgId).maybeSingle();
  if (!startupProfile) return NextResponse.json({ firms: [] });

  const now = new Date().toISOString();
  const { data: matches } = await admin.from('matchdeal_matches').select('investor_catalog_entity_id, cooldown_until')
    .eq('startup_profile_id', startupProfile.id).eq('status', 'active');
  const matchedIds = [...new Set((matches ?? [])
    .filter((m) => !m.cooldown_until || (m.cooldown_until as string) <= now)
    .map((m) => m.investor_catalog_entity_id as string))];
  if (matchedIds.length === 0) return NextResponse.json({ firms: [] });

  const { data: existingThreads } = await admin.from('deal_threads').select('investor_catalog_entity_id').eq('startup_org_id', orgId);
  const alreadyThreaded = new Set((existingThreads ?? []).map((t) => t.investor_catalog_entity_id as string));
  const startableIds = matchedIds.filter((id) => !alreadyThreaded.has(id));
  if (startableIds.length === 0) return NextResponse.json({ firms: [] });

  const { data: catalogEntities } = await admin.from('catalog_entities').select('id, name').in('id', startableIds);
  return NextResponse.json({
    firms: (catalogEntities ?? []).map((c) => ({ investorCatalogEntityId: c.id as string, name: c.name as string })),
  });
}
