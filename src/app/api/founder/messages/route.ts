// P134-C — founder side of Sherlock messaging: the thread list (one row
// per investor firm this org has ever messaged), each with an unread flag
// for the sidebar badge. Same service-role-only pattern as the investor
// side (deal_threads/deal_messages have zero RLS policies) — founder
// identity is resolved via org_members here, not RLS.
// Prompt 197 A — POST is the founder-initiate path. Addenda 2026-08-05 §1
// had gated it on an active MatchDeal match (see matchdeal-active-match.ts)
// — more restrictive than canInvestorMessage's own symmetric criterion
// (status==='interested' || hasDataRoomAccess) and desynced from what the
// founder's own Pipeline already treats as a real relationship. Now checks
// founderMessageEligibleFirms (deal-messages.ts) instead — one rule, not
// duplicated between this route and eligible/route.ts. Replying to a thread
// an INVESTOR already started has no such gate — that route is
// /api/founder/messages/[threadId], unchanged.
//
// GET also takes an optional ?entityId= (Prompt 197 A §2, entities/[id]
// page's own "Message investor" button): resolves that founder-CRM entity
// to the matching eligible firm (resolveFounderEntityToEligibleFirm — no
// stored link between entities and catalog_entities in this schema, most
// entities rows are 'manual' with no platform identity at all) and returns
// canMessage + that thread's existing messages (never creates one — same
// read-only findThread the investor side's GET already uses). Omitting
// entityId keeps the original thread-list behavior unchanged.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveFounderMessageDocs } from '@/lib/deal-messages-resolve';
import { serverClient } from '@/lib/supabase-server';
import { dealMessagesAvailable } from '@/lib/deal-messages-capability';
import {
  findThread, getOrCreateThread, getThreadMessages, markThreadRead, postMessage,
  founderMessageEligibleFirms, resolveFounderEntityToEligibleFirm,
} from '@/lib/deal-messages';

export async function GET(req: Request) {
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

  const entityId = new URL(req.url).searchParams.get('entityId');
  if (entityId) {
    const { data: entity } = await admin.from('entities').select('id, name, website').eq('id', entityId).eq('org_id', orgId).maybeSingle();
    if (!entity) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

    const eligible = await founderMessageEligibleFirms(admin, orgId);
    const firm = resolveFounderEntityToEligibleFirm(entity as { name: string; website: string | null }, eligible);
    if (!firm) return NextResponse.json({ canMessage: false, investorCatalogEntityId: null, messages: [] });

    const thread = await findThread(admin, orgId, firm.investorCatalogEntityId);
    if (!thread) return NextResponse.json({ canMessage: true, investorCatalogEntityId: firm.investorCatalogEntityId, investorName: firm.name, messages: [] });
    const raw = await getThreadMessages(admin, thread.id as string);
    // Prompt 210 §A.4 — anexos resolvidos na leitura: nome + acesso, em vez
    // de um id nu que o cliente nao sabe desenhar.
    const messages = await resolveFounderMessageDocs(admin, orgId, raw);
    await markThreadRead(admin, thread.id as string, 'founder');
    return NextResponse.json({ canMessage: true, investorCatalogEntityId: firm.investorCatalogEntityId, investorName: firm.name, messages });
  }

  const { data: threads } = await admin.from('deal_threads')
    .select('id, investor_catalog_entity_id, last_message_at, founder_last_read_at')
    .eq('startup_org_id', orgId).not('last_message_at', 'is', null)
    .order('last_message_at', { ascending: false });
  if (!threads || threads.length === 0) return NextResponse.json({ threads: [] });

  const catalogIds = [...new Set(threads.map((t) => t.investor_catalog_entity_id as string))];
  // Prompt 257 §2 — Pipeline's "in conversation" band needs to know WHICH
  // founder entity each active thread belongs to. Same catalog_deliveries
  // join every other org-level->entity resolution in this codebase already
  // uses (investor-interest/route.ts, deal-messages.ts) — additive field,
  // existing consumers (the Messages page) ignore it.
  const [{ data: catalogEntities }, { data: deliveryRows }] = await Promise.all([
    admin.from('catalog_entities').select('id, name').in('id', catalogIds),
    admin.from('catalog_deliveries').select('catalog_id, entity_id').eq('org_id', orgId).in('catalog_id', catalogIds),
  ]);
  const nameById = new Map((catalogEntities ?? []).map((c) => [c.id as string, c.name as string]));
  const entityByCatalogId = new Map((deliveryRows ?? []).map((d) => [d.catalog_id as string, d.entity_id as string | null]));

  return NextResponse.json({
    threads: threads.map((t) => ({
      threadId: t.id as string,
      investorName: nameById.get(t.investor_catalog_entity_id as string) ?? 'Unknown investor',
      lastMessageAt: t.last_message_at as string,
      unread: !t.founder_last_read_at || (t.founder_last_read_at as string) < (t.last_message_at as string),
      entityId: entityByCatalogId.get(t.investor_catalog_entity_id as string) ?? null,
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

  const body = await req.json().catch(() => ({})) as { investorCatalogEntityId?: string; body?: string; links?: unknown; documentIds?: string[] };
  if (!body.investorCatalogEntityId) return NextResponse.json({ ok: false, error: 'investorCatalogEntityId is required.' }, { status: 400 });
  if (!body.body?.trim()) return NextResponse.json({ ok: false, error: "Message can't be empty." }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const eligible = await founderMessageEligibleFirms(admin, orgId);
  const qualifies = eligible.some((f) => f.investorCatalogEntityId === body.investorCatalogEntityId);
  if (!qualifies) return NextResponse.json({ ok: false, error: 'No relationship with this investor firm yet.' }, { status: 403 });

  // Prompt 210 §A.2 — validado no SERVIDOR, nunca confiando na lista do
  // cliente: mesmo padrao do lado do investidor (que recomputa o
  // resolveDocumentAccess em vez de aceitar o que lhe mandam). Aqui a regra e
  // mais simples porque o founder e dono da Vault -- basta o documento ser da
  // org dele -- mas a forma e a mesma: pedir a base de dados, nao ao browser.
  const requestedDocIds = [...new Set(body.documentIds ?? [])];
  let allowedDocIds: string[] = [];
  if (requestedDocIds.length > 0) {
    const { data: ownDocs } = await admin.from('documents').select('id').in('id', requestedDocIds).eq('org_id', orgId);
    const owned = new Set((ownDocs ?? []).map((d) => d.id as string));
    allowedDocIds = requestedDocIds.filter((id) => owned.has(id));
  }

  const thread = await getOrCreateThread(admin, orgId, body.investorCatalogEntityId);
  const { error } = await postMessage(admin, {
    threadId: thread.id as string, senderSide: 'founder', senderUserId: user.id,
    body: body.body, links: body.links, documentIds: allowedDocIds,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, threadId: thread.id });
}
