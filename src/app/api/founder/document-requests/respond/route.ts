// Prompt 372 Block D/E — the founder answers ONE item of a document
// request. Four real outcomes, never silence:
//   grant_existing    — the document is already in the Vault: real
//                        access_grants row (same shape as the existing
//                        access-requests action route), item -> granted.
//   fulfill_document  — Block E's central case: the founder just uploaded
//                        a NEW document (via the existing Vault upload
//                        path, verify-upload already ran) and this links
//                        it as the item's fulfilled_document_id, granting
//                        access to it — item -> granted.
//   fulfill_via_message — the founder answered by attaching the file to a
//                        message instead of the Vault (Block E §4) — item
//                        -> granted, fulfilled_document_id stays null,
//                        resolution_note records why.
//   promise           — "not yet" + a real date; the reminder cadence
//                        reschedules to it instead of nagging every 2 days.
//   decline           — a real reason, shown to the investor. Silence is
//                        never treated as an answer.
//   fulfill_cap_table — Prompt 426 §D: the founder built their cap table via
//                        CapTableAiFillPanel (Watson or the no-AI guided
//                        fallback) and saved at least one row. No document
//                        involved — fulfilled_document_id stays null,
//                        resolution_note records how many entries were added.
// Closes the backing task (source='document_request') the moment every
// item on the request has an outcome — never on the first response to a
// multi-item ask.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { isEmailBlocked, BLOCKED_EMAIL_ERROR } from '@/lib/blocked-emails-server';
import { allItemsResolved } from '@/lib/document-request-logic';

type Action = 'grant_existing' | 'fulfill_document' | 'fulfill_via_message' | 'promise' | 'decline' | 'fulfill_cap_table';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as {
    itemId?: string; action?: Action; documentId?: string;
    promisedFor?: string; declineReason?: string; resolutionNote?: string; entryCount?: number;
  };
  if (!body.itemId || !body.action) return NextResponse.json({ ok: false, error: 'itemId and action are required.' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: item } = await admin.from('access_request_items').select('*').eq('id', body.itemId).maybeSingle();
  if (!item) return NextResponse.json({ ok: false, error: 'Item not found.' }, { status: 404 });
  if (item.status !== 'pending') return NextResponse.json({ ok: false, error: `Already ${item.status as string}.` }, { status: 409 });

  const { data: reqRow } = await admin.from('access_requests').select('*').eq('id', item.request_id as string).maybeSingle();
  if (!reqRow) return NextResponse.json({ ok: false, error: 'Request not found.' }, { status: 404 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', reqRow.org_id as string).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { resolved_at: now };

  // Prompt 518 §1 — a folder item is granted as a folder, not a document.
  // grant_existing on an item that names a folder needs no documentId: the
  // target is already on the item. Kept as its own branch rather than widened
  // into the document branch below, because the NDA gate there is a per-
  // DOCUMENT visibility check that has no meaning for a folder.
  if (body.action === 'grant_existing' && !body.documentId && item.folder_id) {
    const requestedEmail = reqRow.person_id ? null : (reqRow.requested_email as string | null);
    if (requestedEmail && await isEmailBlocked(admin, requestedEmail)) {
      return NextResponse.json({ ok: false, error: BLOCKED_EMAIL_ERROR }, { status: 403 });
    }
    const { error: grantError } = await admin.from('access_grants').insert({
      org_id: reqRow.org_id as string, person_id: (reqRow.person_id as string | null) ?? null,
      invited_email: reqRow.person_id ? null : (reqRow.requested_email as string | null),
      folder_id: item.folder_id as string, granted_at: now,
    });
    if (grantError) return NextResponse.json({ ok: false, error: grantError.message }, { status: 500 });
    patch.status = 'granted';
  } else if (body.action === 'grant_existing' || body.action === 'fulfill_document') {
    if (!body.documentId) return NextResponse.json({ ok: false, error: 'documentId is required.' }, { status: 400 });
    const requestedEmail = reqRow.person_id ? null : (reqRow.requested_email as string | null);
    if (requestedEmail && await isEmailBlocked(admin, requestedEmail)) {
      return NextResponse.json({ ok: false, error: BLOCKED_EMAIL_ERROR }, { status: 403 });
    }
    // Block F — a due_diligence document answered via a request still goes
    // through the NDA gate, same as any other route into it: the grant is
    // created locked (nda_required: true) rather than open, and
    // resolveDocumentAccess (data-room.ts) already treats that exactly like
    // any other pending-NDA grant until nda-upload's document-scoped unlock
    // (see that route) stamps nda_accepted_at for THIS document.
    const { data: doc } = await admin.from('documents').select('visibility').eq('id', body.documentId).maybeSingle();
    const ndaRequired = doc?.visibility === 'due_diligence';
    const { error: grantError } = await admin.from('access_grants').insert({
      org_id: reqRow.org_id as string, person_id: (reqRow.person_id as string | null) ?? null,
      invited_email: reqRow.person_id ? null : (reqRow.requested_email as string | null),
      document_id: body.documentId, granted_at: now, nda_required: ndaRequired,
    });
    if (grantError) return NextResponse.json({ ok: false, error: grantError.message }, { status: 500 });
    patch.status = 'granted';
    if (body.action === 'fulfill_document') patch.fulfilled_document_id = body.documentId;
    if (ndaRequired) patch.resolution_note = 'Granted pending NDA — access opens once the signed NDA is on file for this document.';
  } else if (body.action === 'fulfill_via_message') {
    patch.status = 'granted';
    patch.resolution_note = body.resolutionNote?.trim() || 'Sent as a message attachment — not added to the Data Room.';
  } else if (body.action === 'promise') {
    if (!body.promisedFor) return NextResponse.json({ ok: false, error: 'promisedFor is required.' }, { status: 400 });
    patch.status = 'promised';
    patch.promised_for = body.promisedFor;
  } else if (body.action === 'decline') {
    if (!body.declineReason?.trim()) return NextResponse.json({ ok: false, error: 'A decline needs a real reason — silence is never an answer.' }, { status: 400 });
    patch.status = 'declined';
    patch.decline_reason = body.declineReason.trim();
  } else if (body.action === 'fulfill_cap_table') {
    const n = body.entryCount ?? 0;
    patch.status = 'granted';
    patch.resolution_note = `Cap table added — ${n} ${n === 1 ? 'entry' : 'entries'}.`;
  } else {
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  }

  const { error: updateError } = await admin.from('access_request_items').update(patch).eq('id', body.itemId);
  if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });

  // Close the backing task only once every item on this request has an
  // outcome — a 3-item request answered on item 1 stays open.
  const { data: siblingItems } = await admin.from('access_request_items').select('status').eq('request_id', item.request_id as string);
  if (allItemsResolved((siblingItems ?? []) as { status: 'pending' | 'granted' | 'promised' | 'declined' }[])) {
    await admin.from('tasks').update({ done: true })
      .eq('org_id', reqRow.org_id as string).eq('source', 'document_request')
      .like('notes', `%request:${item.request_id as string}%`);
  }

  return NextResponse.json({ ok: true, status: patch.status });
}
