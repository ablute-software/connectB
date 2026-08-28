// Prompt 372 Block C — founder-side list of document requests, for the
// popup (unseen ones) and the Tasks/Documents screens (all pending ones).
// Same shape as /api/founder/investor-interest's own GET/POST(seen) split.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { accessRequestItemsAvailable, documentRequestItemTypeAvailable } from '@/lib/document-request-capability';
import { allItemsResolved } from '@/lib/document-request-logic';

// Prompt 426 §A — item_type is only ever selected via a dynamically-built
// string (see itemsSelect below), so postgrest-js can't statically infer a
// row shape for it the way it does for the rest of this file's literal
// select strings; this is that shape, supplied explicitly instead.
interface AccessRequestItemRow {
  id: string; request_id: string; document_id: string | null; requested_label: string | null;
  status: 'pending' | 'granted' | 'promised' | 'declined'; fulfilled_document_id: string | null;
  promised_for: string | null; decline_reason: string | null; resolution_note: string | null;
  item_type?: string | null;
}

async function resolveFounderOrgId(sb: Awaited<ReturnType<typeof serverClient>>, userId: string) {
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (member?.org_id as string | undefined) ?? null;
}

export async function GET(req: Request) {
  if (!authEnabled) return NextResponse.json({ requests: [] });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ requests: [] }, { status: 401 });

  const orgId = await resolveFounderOrgId(sb, user.id);
  if (!orgId) return NextResponse.json({ requests: [] });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ requests: [] });
  if (!(await accessRequestItemsAvailable())) return NextResponse.json({ requests: [] });
  // Prompt 426 §A — lets this page know an item is specifically a cap-table
  // request, so it can offer "Watson, help me build it" instead of the 4
  // generic document-answer options. Missing-table-safe, same pattern as
  // portal/document-requests/route.ts's own use of this same probe.
  const itemTypeAvailable = await documentRequestItemTypeAvailable();
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // ?unseen=1 — the popup's own query, mirroring InvestorInterestPopup's
  // seen_at filter exactly (only never-shown requests trigger the popup;
  // the "Ver pedido" page below reads everything unresolved regardless).
  // ?id=X — a single request, for the "Ver pedido" review page (returned
  // regardless of resolved state, so a founder can still see what they
  // already answered).
  const params = new URL(req.url).searchParams;
  const unseenOnly = params.get('unseen') === '1';
  const singleId = params.get('id');
  let query = admin.from('access_requests')
    .select('id, person_id, requested_email, message, requested_at, founder_seen_at')
    .eq('org_id', orgId).eq('kind', 'document');
  if (singleId) query = query.eq('id', singleId);
  else if (unseenOnly) query = query.is('founder_seen_at', null);
  const { data: requests } = await query.order('requested_at', { ascending: true });
  if (!requests || requests.length === 0) return NextResponse.json({ requests: [] });

  const requestIds = requests.map((r) => r.id as string);
  // Built dynamically (item_type only when the migration is applied), so
  // this is typed as a plain `string` rather than a literal — postgrest-js's
  // select() otherwise tries to statically PARSE a template-literal type,
  // which fails on a non-literal (ternary-widened) string.
  const itemsSelect: string = `id, request_id, document_id, requested_label, status, fulfilled_document_id, promised_for, decline_reason, resolution_note${itemTypeAvailable ? ', item_type' : ''}`;
  const { data: itemsRaw } = await admin.from('access_request_items')
    .select(itemsSelect)
    .in('request_id', requestIds);
  const items = itemsRaw as unknown as AccessRequestItemRow[] | null;

  const personIds = [...new Set(requests.filter((r) => r.person_id).map((r) => r.person_id as string))];
  const docIds = [...new Set((items ?? []).flatMap((i) => [i.document_id, i.fulfilled_document_id]).filter(Boolean) as string[])];
  const [{ data: people }, { data: docs }] = await Promise.all([
    personIds.length ? admin.from('people').select('id, full_name, entity_id').in('id', personIds) : Promise.resolve({ data: [] as { id: string; full_name: string; entity_id: string | null }[] }),
    docIds.length ? admin.from('documents').select('id, name').in('id', docIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const personById = new Map((people ?? []).map((p) => [p.id as string, p]));
  const docNameById = new Map((docs ?? []).map((d) => [d.id as string, d.name as string]));

  const itemsByRequest = new Map<string, typeof items>();
  for (const i of items ?? []) {
    const list = itemsByRequest.get(i.request_id as string) ?? [];
    list.push(i);
    itemsByRequest.set(i.request_id as string, list as never);
  }

  const shaped = requests.map((r) => {
    const reqItems = itemsByRequest.get(r.id as string) ?? [];
    const person = r.person_id ? personById.get(r.person_id as string) : null;
    return {
      id: r.id, requesterName: person?.full_name ?? null, requesterEmail: r.requested_email as string | null,
      entityId: person?.entity_id ?? null, message: r.message, requestedAt: r.requested_at,
      resolved: allItemsResolved((reqItems as { status: 'pending' | 'granted' | 'promised' | 'declined' }[])),
      items: reqItems.map((i) => ({
        id: i.id, documentId: i.document_id, label: i.document_id ? (docNameById.get(i.document_id as string) ?? 'Document') : (i.requested_label as string),
        status: i.status, fulfilledDocumentId: i.fulfilled_document_id,
        promisedFor: i.promised_for, declineReason: i.decline_reason, resolutionNote: i.resolution_note,
        itemType: (i.item_type as 'cap_table' | null) ?? null,
      })),
    };
  });

  return NextResponse.json({ requests: (singleId || unseenOnly) ? shaped : shaped.filter((r) => !r.resolved) });
}

export async function POST(req: Request) {
  if (!authEnabled) return NextResponse.json({ ok: false }, { status: 200 });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const orgId = await resolveFounderOrgId(sb, user.id);
  if (!orgId) return NextResponse.json({ ok: false, error: 'No org.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { requestId?: string };
  if (!body.requestId) return NextResponse.json({ ok: false, error: 'requestId is required.' }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false }, { status: 200 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  await admin.from('access_requests').update({ founder_seen_at: new Date().toISOString() })
    .eq('org_id', orgId).eq('id', body.requestId);

  return NextResponse.json({ ok: true });
}
