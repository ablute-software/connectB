// P134-C — Sherlock messaging. One continuous thread per (startup,
// investor firm) pair; shared by both the investor-side and founder-side
// routes so the relationship/document-grant validation only lives once.
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeDomain, normalizeName } from './catalog-dedupe';
import { domainMatchesEntity } from './investor-domain-match';

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

// Prompt 197 A — the founder-initiate side of canInvestorMessage's own
// symmetric criterion. canInvestorMessage(card) is status==='interested' ||
// hasDataRoomAccess, computed for the INVESTOR from their own already-known
// email/team; the reverse (given a startup org, which investor firms
// currently qualify) is genuinely harder for the grant half specifically:
// access_grants stores grantee_email/invited_email (plain text), and
// there's no cheap email->catalog_entity_id path in this schema (no email
// column on matchdeal_investor_members, no getUserByEmail on the Supabase
// admin API — only getUserById/listUsers). Reversing it would mean an
// unbounded listUsers() scan or a new indexed mapping — a real schema
// change, out of scope here. So this only covers the 'interested' half.
// Flagged, not silently narrowed: in practice a firm with data-room access
// but no recorded 'interested' decision is the rare case, not the common
// path (P132-A's eligibility union already treats a grant as a strong
// enough signal that a decision usually gets recorded through the normal
// Pipeline flow anyway) — but it IS a real gap if it ever isn't.
export interface FounderMessageEligibleFirm { investorCatalogEntityId: string; name: string; website: string | null }

export async function founderMessageEligibleFirms(admin: SupabaseClient, orgId: string): Promise<FounderMessageEligibleFirm[]> {
  const { data: decisions } = await admin.from('investor_relationship_decisions')
    .select('investor_catalog_entity_id').eq('org_id', orgId).eq('decision', 'interested');
  const ids = [...new Set((decisions ?? []).map((d) => d.investor_catalog_entity_id as string))];
  if (ids.length === 0) return [];
  const { data: catalogEntities } = await admin.from('catalog_entities').select('id, name, website').in('id', ids);
  return (catalogEntities ?? []).map((c) => ({
    investorCatalogEntityId: c.id as string, name: c.name as string, website: (c.website as string | null) ?? null,
  }));
}

// Resolves a founder's own CRM entity (entities.id, entirely disconnected
// from catalog_entities in the schema — most rows are 'manual', typed in by
// the founder with no platform identity attached) to the investor firm it
// most likely refers to, among the ones this startup may actually message.
// Domain match first — this app's dominant identity key elsewhere
// (investor-domain-match.ts) — name match (exact, after normalization) as
// the fallback for an entity with no website on file. No match means
// exactly that: this app can't tell who, on the platform, this tracked
// investor even is, so there's genuinely nothing to open a Sherlock thread
// with — the caller should treat that as "don't show the button," not an
// error.
export function resolveFounderEntityToEligibleFirm(
  entity: { name: string; website?: string | null },
  eligible: FounderMessageEligibleFirm[],
): FounderMessageEligibleFirm | null {
  const entityDomain = normalizeDomain(entity.website ?? null);
  if (entityDomain) {
    const byDomain = eligible.find((f) => {
      const firmDomain = normalizeDomain(f.website);
      return !!firmDomain && domainMatchesEntity(entityDomain, firmDomain);
    });
    if (byDomain) return byDomain;
  }
  const entityName = normalizeName(entity.name);
  if (!entityName) return null;
  return eligible.find((f) => normalizeName(f.name) === entityName) ?? null;
}
