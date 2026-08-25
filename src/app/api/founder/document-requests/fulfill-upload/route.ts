// Prompt 372 Block E — the central case: the document did NOT exist in
// the Vault, the founder just uploaded it from their computer (via the
// EXISTING verify-upload path — /api/data-room/verify-upload already ran
// client-side by the time this is called, never a second write path into
// Storage), and this one call creates the real documents row, grants the
// requester access to it, links it as the item's fulfilled_document_id,
// and closes the backing task if this was the last open item. Done
// server-side in one route rather than the client store's addDocument so
// the whole "create + grant + link" sequence is coordinated in one place —
// this is a request-fulfillment flow, not an ordinary Vault upload.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { isEmailBlocked, BLOCKED_EMAIL_ERROR } from '@/lib/blocked-emails-server';
import { allItemsResolved } from '@/lib/document-request-logic';
import type { DocVisibility } from '@/lib/types';

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
    itemId?: string; storagePath?: string; fileName?: string; malwareScanStatus?: string;
    folderId?: string | null; newFolderName?: string; visibility?: DocVisibility; ndaRequired?: boolean;
  };
  if (!body.itemId || !body.storagePath || !body.fileName || !body.visibility) {
    return NextResponse.json({ ok: false, error: 'itemId, storagePath, fileName, and visibility are required.' }, { status: 400 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: item } = await admin.from('access_request_items').select('*').eq('id', body.itemId).maybeSingle();
  if (!item) return NextResponse.json({ ok: false, error: 'Item not found.' }, { status: 404 });
  if (item.status !== 'pending') return NextResponse.json({ ok: false, error: `Already ${item.status as string}.` }, { status: 409 });

  const { data: reqRow } = await admin.from('access_requests').select('*').eq('id', item.request_id as string).maybeSingle();
  if (!reqRow) return NextResponse.json({ ok: false, error: 'Request not found.' }, { status: 404 });
  const orgId = reqRow.org_id as string;
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', orgId).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const requestedEmail = reqRow.person_id ? null : (reqRow.requested_email as string | null);
  if (requestedEmail && await isEmailBlocked(admin, requestedEmail)) {
    return NextResponse.json({ ok: false, error: BLOCKED_EMAIL_ERROR }, { status: 403 });
  }

  // Prompt 372 Block E §2 — "create a new folder inline" needs a real id
  // back before the document insert; there is no plan-level gate on folder
  // creation anywhere in plans.ts (confirmed by reading it — folder
  // creation is unrestricted today), so this never blocks on plan tier,
  // consistent with the rest of the app.
  let folderId = body.folderId || null;
  if (!folderId && body.newFolderName?.trim()) {
    const { data: newFolder, error: folderError } = await admin.from('folders')
      .insert({ org_id: orgId, name: body.newFolderName.trim(), parent_id: null, kind: 'data_room' }).select('id').single();
    if (folderError) return NextResponse.json({ ok: false, error: folderError.message }, { status: 500 });
    folderId = newFolder!.id as string;
  }

  const { data: doc, error: docError } = await admin.from('documents').insert({
    org_id: orgId, folder_id: folderId, name: body.fileName, storage_path: body.storagePath,
    is_view_only: true, visibility: body.visibility, watermark: false, downloadable: false,
    malware_scan_status: body.malwareScanStatus ?? 'not_scanned',
  }).select('id').single();
  if (docError) return NextResponse.json({ ok: false, error: docError.message }, { status: 500 });
  const documentId = doc!.id as string;

  const now = new Date().toISOString();
  const { error: grantError } = await admin.from('access_grants').insert({
    org_id: orgId, person_id: (reqRow.person_id as string | null) ?? null,
    invited_email: reqRow.person_id ? null : requestedEmail,
    document_id: documentId, nda_required: !!body.ndaRequired, granted_at: now,
  });
  if (grantError) return NextResponse.json({ ok: false, error: grantError.message }, { status: 500 });

  await admin.from('access_request_items').update({ status: 'granted', fulfilled_document_id: documentId, resolved_at: now }).eq('id', body.itemId);

  const { data: siblingItems } = await admin.from('access_request_items').select('status').eq('request_id', item.request_id as string);
  if (allItemsResolved((siblingItems ?? []) as { status: 'pending' | 'granted' | 'promised' | 'declined' }[])) {
    await admin.from('tasks').update({ done: true })
      .eq('org_id', orgId).eq('source', 'document_request').like('notes', `%request:${item.request_id as string}%`);
  }

  return NextResponse.json({ ok: true, documentId });
}
