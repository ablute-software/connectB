// Prompt 372 — the investor's half of the document-request cycle. GET
// returns this investor's own requests + item statuses (Block G — "nada
// sobre a actividade do founder", only what happened to THIS request).
// POST creates a request with any number of items in one call (Block B —
// "sem limites de quantidade e sem cap de pedidos pendentes").
//
// Reuses access_requests/access_request_items (migration 0243) rather than
// a new table — kind='document' distinguishes these from the existing
// 'access'-kind rows (e.g. "Request again" on an expired grant).
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { accessRequestItemsAvailable, documentRequestFieldsAvailable } from '@/lib/document-request-capability';
import { nextReminderAt, documentRequestPriorityKind } from '@/lib/document-request-logic';

const MAX_ITEMS_PER_REQUEST = 50;

async function resolvePerson(admin: SupabaseClient, email: string) {
  const { data } = await admin.from('people').select('id, full_name, entity_id').eq('email_verified', email).maybeSingle();
  return data as { id: string; full_name: string | null; entity_id: string | null } | null;
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ requests: [] }, { status: 200 });

  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  if (!(await accessRequestItemsAvailable())) return NextResponse.json({ requests: [] });

  const person = await resolvePerson(admin, email);
  const orParts = [`requested_email.eq.${email}`];
  if (person) orParts.push(`person_id.eq.${person.id}`);
  const { data: requests } = await admin.from('access_requests')
    .select('id, message, requested_at, investor_seen_response_at')
    .eq('org_id', orgId).eq('kind', 'document').or(orParts.join(',')).order('requested_at', { ascending: false });
  if (!requests || requests.length === 0) return NextResponse.json({ requests: [] });

  const requestIds = requests.map((r) => r.id as string);
  const { data: items } = await admin.from('access_request_items')
    .select('id, request_id, document_id, requested_label, status, fulfilled_document_id, promised_for, decline_reason, resolution_note')
    .in('request_id', requestIds);

  const docIds = [...new Set((items ?? []).flatMap((i) => [i.document_id, i.fulfilled_document_id]).filter(Boolean) as string[])];
  const { data: docs } = docIds.length
    ? await admin.from('documents').select('id, name').in('id', docIds)
    : { data: [] as { id: string; name: string }[] };
  const docNameById = new Map((docs ?? []).map((d) => [d.id as string, d.name as string]));

  const itemsByRequest = new Map<string, typeof items>();
  for (const i of items ?? []) {
    const list = itemsByRequest.get(i.request_id as string) ?? [];
    list.push(i);
    itemsByRequest.set(i.request_id as string, list as never);
  }

  return NextResponse.json({
    requests: requests.map((r) => ({
      id: r.id, message: r.message, requestedAt: r.requested_at, seen: !!r.investor_seen_response_at,
      items: (itemsByRequest.get(r.id as string) ?? []).map((i) => ({
        id: i.id,
        label: i.document_id ? (docNameById.get(i.document_id as string) ?? 'Document') : (i.requested_label as string),
        status: i.status,
        fulfilledDocumentName: i.fulfilled_document_id ? (docNameById.get(i.fulfilled_document_id as string) ?? null) : null,
        promisedFor: i.promised_for, declineReason: i.decline_reason, resolutionNote: i.resolution_note,
      })),
    })),
  });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as {
    orgId?: string; message?: string;
    items?: { documentId?: string; label?: string }[];
  };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  const items = (body.items ?? []).slice(0, MAX_ITEMS_PER_REQUEST)
    .map((i) => ({ documentId: i.documentId?.trim() || undefined, label: i.label?.trim() || undefined }))
    .filter((i) => i.documentId || i.label);
  if (items.length === 0) return NextResponse.json({ ok: false, error: 'Pick at least one document, or describe what you need.' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  if (!(await accessRequestItemsAvailable()) || !(await documentRequestFieldsAvailable())) {
    return NextResponse.json({ ok: false, error: 'not configured' });
  }

  const person = await resolvePerson(admin, email);

  // Block B §3 — "asking again for a pending item never creates a second
  // row, it just shows it's already pending" — never fricton, never noise.
  const orParts = [`requested_email.eq.${email}`];
  if (person) orParts.push(`person_id.eq.${person.id}`);
  const { data: existingRequests } = await admin.from('access_requests')
    .select('id').eq('org_id', body.orgId).eq('kind', 'document').or(orParts.join(','));
  const existingRequestIds = (existingRequests ?? []).map((r) => r.id as string);
  const { data: existingPendingItems } = existingRequestIds.length
    ? await admin.from('access_request_items').select('document_id, requested_label').in('request_id', existingRequestIds).eq('status', 'pending')
    : { data: [] as { document_id: string | null; requested_label: string | null }[] };
  const alreadyPendingDocIds = new Set((existingPendingItems ?? []).map((i) => i.document_id).filter(Boolean) as string[]);
  const alreadyPendingLabels = new Set((existingPendingItems ?? []).map((i) => (i.requested_label ?? '').trim().toLowerCase()).filter(Boolean));

  const newItems = items.filter((i) => (i.documentId ? !alreadyPendingDocIds.has(i.documentId) : !alreadyPendingLabels.has((i.label ?? '').toLowerCase())));
  const alreadyPendingCount = items.length - newItems.length;
  if (newItems.length === 0) {
    return NextResponse.json({ ok: true, created: false, alreadyPendingCount, message: 'Everything in this request is already pending — no need to ask twice.' });
  }

  const { data: request, error: reqError } = await admin.from('access_requests').insert({
    org_id: body.orgId, person_id: person?.id ?? null, requested_email: person ? null : email,
    kind: 'document', status: 'pending', message: body.message?.trim() || null,
  }).select('id').single();
  if (reqError) return NextResponse.json({ ok: false, error: reqError.message }, { status: 500 });
  const requestId = request!.id as string;

  const { error: itemsError } = await admin.from('access_request_items').insert(
    newItems.map((i) => ({ request_id: requestId, document_id: i.documentId ?? null, requested_label: i.documentId ? null : i.label })),
  );
  if (itemsError) return NextResponse.json({ ok: false, error: itemsError.message }, { status: 500 });

  // Block C — same interest->task shape as migration 0129, done in app code
  // since this insert isn't itself a DB function/trigger. Priority: a
  // document request from an investor already IN DILIGENCE with this org
  // outranks one from anyone else (Block C §4's tier 2 vs tier 4) —
  // resolved via the SAME entity this person is already linked to, never a
  // guess from the request itself.
  let entityId: string | null = person?.entity_id ?? null;
  let inDiligence = false;
  if (entityId) {
    const { data: entity } = await admin.from('entities').select('status').eq('id', entityId).maybeSingle();
    inDiligence = entity?.status === 'diligence';
  }
  const priorityKind = documentRequestPriorityKind(inDiligence);
  const now = new Date();
  const dueAt = inDiligence ? now : new Date(now.getTime() + 2 * 86_400_000);
  const firstReminderAt = nextReminderAt(now, 0);
  if (entityId) {
    await admin.from('tasks').insert({
      org_id: body.orgId, title: `Document request: ${newItems.length} item${newItems.length === 1 ? '' : 's'}`,
      due_at: dueAt.toISOString(), entity_id: entityId, kind: 'follow_up', action_type: 'follow_up_thread',
      source: 'document_request', reminder_at: firstReminderAt.toISOString(),
      notes: `priority:${priorityKind}|request:${requestId}`,
    });
  }

  return NextResponse.json({ ok: true, created: true, requestId, alreadyPendingCount });
}
