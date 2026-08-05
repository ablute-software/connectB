// P134-C — Sherlock messaging. One continuous thread per (startup,
// investor firm) pair; shared by both the investor-side and founder-side
// routes so the relationship/document-grant validation only lives once.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface DealMessage {
  id: string; senderSide: 'investor' | 'founder'; senderUserId: string;
  body: string; links: { label: string; url: string }[]; documentIds: string[]; createdAt: string;
}

const MAX_LINKS = 20;

// R2 (Prompt 134 §4) — investor can message only where a real relationship
// already exists: interest expressed, or an active data-room grant. A
// passed relationship or a bare discovery match doesn't qualify. Pure and
// exported (moved out of /api/portal/messages/route.ts) so this exact
// authorization boundary is unit-tested directly, not just exercised
// incidentally through a mocked route.
export function canInvestorMessage(card: { status: string; hasDataRoomAccess: boolean } | null | undefined): boolean {
  return !!card && (card.status === 'interested' || card.hasDataRoomAccess);
}

function sanitizeLinks(raw: unknown): { label: string; url: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { label: string; url: string }[] = [];
  for (const item of raw) {
    if (out.length >= MAX_LINKS) break;
    if (!item || typeof item !== 'object') continue;
    const url = typeof (item as { url?: unknown }).url === 'string' ? (item as { url: string }).url.trim() : '';
    if (!/^https?:\/\//i.test(url)) continue;
    const rawLabel = typeof (item as { label?: unknown }).label === 'string' ? (item as { label: string }).label.trim() : '';
    out.push({ label: rawLabel || url, url });
  }
  return out;
}

// A thread is one row per (startup, investor firm) pair — "the mix of DM"
// the mini-prompt asked for, a continuous conversation rather than one-off
// emails. Created lazily on the first message either side sends.
export async function getOrCreateThread(admin: SupabaseClient, startupOrgId: string, investorCatalogEntityId: string) {
  const { data: existing } = await admin.from('deal_threads').select('id, last_message_at, investor_last_read_at, founder_last_read_at')
    .eq('startup_org_id', startupOrgId).eq('investor_catalog_entity_id', investorCatalogEntityId).maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await admin.from('deal_threads')
    .insert({ startup_org_id: startupOrgId, investor_catalog_entity_id: investorCatalogEntityId })
    .select('id, last_message_at, investor_last_read_at, founder_last_read_at').single();
  if (error) throw error;
  return created;
}

// Read-only lookup (no insert) — for listing/unread-count routes that must
// never conjure a thread into existence just by being polled.
export async function findThread(admin: SupabaseClient, startupOrgId: string, investorCatalogEntityId: string) {
  const { data } = await admin.from('deal_threads').select('id, last_message_at, investor_last_read_at, founder_last_read_at')
    .eq('startup_org_id', startupOrgId).eq('investor_catalog_entity_id', investorCatalogEntityId).maybeSingle();
  return data ?? null;
}

export async function getThreadMessages(admin: SupabaseClient, threadId: string): Promise<DealMessage[]> {
  const { data } = await admin.from('deal_messages')
    .select('id, sender_side, sender_user_id, body, links, document_ids, created_at')
    .eq('thread_id', threadId).order('created_at', { ascending: true });
  return (data ?? []).map((m) => ({
    id: m.id as string, senderSide: m.sender_side as 'investor' | 'founder', senderUserId: m.sender_user_id as string,
    body: m.body as string, links: sanitizeLinks(m.links), documentIds: (m.document_ids as string[]) ?? [], createdAt: m.created_at as string,
  }));
}

// document_ids validation happens in the caller (it already has the grant
// context loaded) — this just persists the ids it's given and bumps the
// thread's own timestamps.
export async function postMessage(
  admin: SupabaseClient,
  opts: { threadId: string; senderSide: 'investor' | 'founder'; senderUserId: string; body: string; links: unknown; documentIds: string[] },
) {
  const body = opts.body.trim();
  if (!body) return { error: { message: 'Message can\'t be empty.' } };
  const now = new Date().toISOString();
  const { error } = await admin.from('deal_messages').insert({
    thread_id: opts.threadId, sender_side: opts.senderSide, sender_user_id: opts.senderUserId,
    body, links: sanitizeLinks(opts.links), document_ids: opts.documentIds,
  });
  if (error) return { error };
  const readField = opts.senderSide === 'investor' ? 'investor_last_read_at' : 'founder_last_read_at';
  await admin.from('deal_threads').update({ last_message_at: now, [readField]: now }).eq('id', opts.threadId);
  return { error: null };
}

export async function markThreadRead(admin: SupabaseClient, threadId: string, side: 'investor' | 'founder') {
  const field = side === 'investor' ? 'investor_last_read_at' : 'founder_last_read_at';
  await admin.from('deal_threads').update({ [field]: new Date().toISOString() }).eq('id', threadId);
}
