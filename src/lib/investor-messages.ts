import 'server-only';
// Prompt 340 Block D — Messages tab. Lists every deal_threads row for this
// investor that has at least one message, newest first, with the last
// message's own excerpt and an unread flag from the exact same
// investor_last_read_at comparison /api/portal/actions-required already
// uses for its own unread-threads source — never a second definition of
// "unread".
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MessageThreadForInvestor {
  orgId: string; orgName: string; lastMessageAt: string; lastExcerpt: string; unread: boolean;
}

const EXCERPT_MAX = 120;

export async function getMessageThreadsForInvestor(admin: SupabaseClient, investorCatalogEntityId: string): Promise<MessageThreadForInvestor[]> {
  const { data } = await admin.from('deal_threads')
    .select('id, startup_org_id, last_message_at, investor_last_read_at, orgs(name)')
    .eq('investor_catalog_entity_id', investorCatalogEntityId)
    .not('last_message_at', 'is', null)
    .order('last_message_at', { ascending: false });
  const rows = (data ?? []) as unknown as { id: string; startup_org_id: string; last_message_at: string; investor_last_read_at: string | null; orgs: { name: string } | null }[];
  if (rows.length === 0) return [];

  return Promise.all(rows.map(async (r) => {
    const { data: lastMsg } = await admin.from('deal_messages').select('body')
      .eq('thread_id', r.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const body = (lastMsg?.body as string | undefined) ?? '';
    return {
      orgId: r.startup_org_id, orgName: r.orgs?.name ?? 'A startup', lastMessageAt: r.last_message_at,
      lastExcerpt: body.length > EXCERPT_MAX ? `${body.slice(0, EXCERPT_MAX)}…` : body,
      unread: !r.investor_last_read_at || r.investor_last_read_at < r.last_message_at,
    };
  }));
}
