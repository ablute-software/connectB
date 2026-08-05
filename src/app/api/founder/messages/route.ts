// P134-C — founder side of Sherlock messaging: the thread list (one row
// per investor firm this org has ever messaged), each with an unread flag
// for the sidebar badge. Same service-role-only pattern as the investor
// side (deal_threads/deal_messages have zero RLS policies) — founder
// identity is resolved via org_members here, not RLS.
// Addenda 2026-08-05 §1 — POST is the founder-initiate path: Nuno's own
// decision, more restrictive than this feature's original R2 recommendation
// ("founder can message any Pipeline relationship"). A founder may only
// START a new thread with an investor firm that has an active MatchDeal
// match against this startup — see matchdeal-active-match.ts's own header
// for the exact status/cooldown definition this shares with the dossier's
// own "Conversation on MatchDeal" link-out (§3, same predicate, one place).
// Replying to a thread an INVESTOR already started has no such gate — that
// route is /api/founder/messages/[threadId], unchanged.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { dealMessagesAvailable } from '@/lib/deal-messages-capability';
import { hasActiveMatchDealMatch } from '@/lib/matchdeal-active-match';
import { getOrCreateThread, postMessage } from '@/lib/deal-messages';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ threads: [] }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  if (!(await dealMessagesAvailable())) return NextResponse.json({ threads: [] });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ threads: [] });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: threads } = await admin.from('deal_threads')
    .select('id, investor_catalog_entity_id, last_message_at, founder_last_read_at')
    .eq('startup_org_id', orgId).not('last_message_at', 'is', null)
    .order('last_message_at', { ascending: false });
  if (!threads || threads.length === 0) return NextResponse.json({ threads: [] });

  const catalogIds = [...new Set(threads.map((t) => t.investor_catalog_entity_id as string))];
  const { data: catalogEntities } = await admin.from('catalog_entities').select('id, name').in('id', catalogIds);
  const nameById = new Map((catalogEntities ?? []).map((c) => [c.id as string, c.name as string]));

  return NextResponse.json({
    threads: threads.map((t) => ({
      threadId: t.id as string,
      investorName: nameById.get(t.investor_catalog_entity_id as string) ?? 'Unknown investor',
      lastMessageAt: t.last_message_at as string,
      unread: !t.founder_last_read_at || (t.founder_last_read_at as string) < (t.last_message_at as string),
    })),
  });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  if (!(await dealMessagesAvailable())) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 403 });
  const orgId = member.org_id as string;

  const body = await req.json().catch(() => ({})) as { investorCatalogEntityId?: string; body?: string; links?: unknown };
  if (!body.investorCatalogEntityId) return NextResponse.json({ ok: false, error: 'investorCatalogEntityId is required.' }, { status: 400 });
  if (!body.body?.trim()) return NextResponse.json({ ok: false, error: "Message can't be empty." }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: startupProfile } = await admin.from('matchdeal_profiles').select('id').eq('kind', 'startup').eq('membership_id', orgId).maybeSingle();
  const qualifies = startupProfile ? await hasActiveMatchDealMatch(admin, startupProfile.id as string, body.investorCatalogEntityId) : false;
  if (!qualifies) return NextResponse.json({ ok: false, error: 'No active MatchDeal match with this firm yet.' }, { status: 403 });

  const thread = await getOrCreateThread(admin, orgId, body.investorCatalogEntityId);
  const { error } = await postMessage(admin, {
    threadId: thread.id as string, senderSide: 'founder', senderUserId: user.id,
    body: body.body, links: body.links, documentIds: [],
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, threadId: thread.id });
}
