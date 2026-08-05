// P134-C — founder side of Sherlock messaging: the thread list (one row
// per investor firm this org has ever messaged), each with an unread flag
// for the sidebar badge. Same service-role-only pattern as the investor
// side (deal_threads/deal_messages have zero RLS policies) — founder
// identity is resolved via org_members here, not RLS.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { dealMessagesAvailable } from '@/lib/deal-messages-capability';

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
