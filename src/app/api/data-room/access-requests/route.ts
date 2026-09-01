// Item 1 (Lote E) step 5 — the founder-side half of access_requests, which
// the 07/08/2026 commit (8684c54) found stalled in the same shape as
// guest_token: the write path ("Request again" on an expired card,
// /api/portal/access-requests) works, but nothing on the founder side could
// ever see or act on a pending row. Confirmed by Nuno to be in scope for
// this lote, not deferred.
//
// RLS already lets an org member SELECT access_requests directly
// (migration 0114's access_requests_org_members_select policy), but this
// route also needs to resolve requester/folder/document NAMES across
// people/folders/documents for display — same shape as
// /api/portal/access-granted's own resolution — so it goes through
// service-role like every other data-room route in this app, not a raw
// browser-client read.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ requests: [] }, { status: 200 });

  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', orgId).maybeSingle();
  if (!member) return NextResponse.json({ error: 'Not a member of this org.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: rows, error } = await admin.from('access_requests').select('*')
    .eq('org_id', orgId).eq('status', 'pending').order('requested_at', { ascending: true });
  if (error) {
    // Same degrade-gracefully convention as every other capability-gated
    // table in this app: a missing table (pre-migration) reads as "nothing
    // pending" rather than a 500.
    return NextResponse.json({ requests: [] }, { status: 200 });
  }

  const requests = rows ?? [];
  const personIds = [...new Set(requests.filter((r) => r.person_id).map((r) => r.person_id as string))];
  const { data: people } = personIds.length
    ? await admin.from('people').select('id, full_name, email_verified').in('id', personIds)
    : { data: [] as { id: string; full_name: string | null; email_verified: string | null }[] };
  const personById = new Map((people ?? []).map((p) => [p.id as string, p]));

  const folderIds = [...new Set(requests.flatMap((r) => (r.folder_ids as string[]) ?? []))];
  const documentIds = [...new Set(requests.flatMap((r) => (r.document_ids as string[]) ?? []))];
  const [{ data: folders }, { data: docs }] = await Promise.all([
    folderIds.length ? admin.from('folders').select('id, name').in('id', folderIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    documentIds.length ? admin.from('documents').select('id, name').in('id', documentIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const folderNameById = new Map((folders ?? []).map((f) => [f.id as string, f.name as string]));
  const docNameById = new Map((docs ?? []).map((d) => [d.id as string, d.name as string]));

  // Prompt 518 §1 — a request created through the items-based flow carries
  // NOTHING in the flat folder_ids/document_ids arrays, so this list used to
  // render it as the bare word "access": the founder could not tell what was
  // being asked for, on the row whose button was also silently failing. The
  // item count is read here so the row says something true.
  const { data: itemRows } = await admin.from('access_request_items')
    .select('request_id, status').in('request_id', requests.map((r) => r.id as string));
  const pendingItemsByRequest = new Map<string, number>();
  for (const i of itemRows ?? []) {
    if (i.status !== 'pending') continue;
    const id = i.request_id as string;
    pendingItemsByRequest.set(id, (pendingItemsByRequest.get(id) ?? 0) + 1);
  }

  return NextResponse.json({
    requests: requests.map((r) => {
      const person = r.person_id ? personById.get(r.person_id as string) : null;
      return {
        id: r.id as string,
        requesterName: (person?.full_name as string | null | undefined) ?? null,
        requesterEmail: (person?.email_verified as string | null | undefined) ?? (r.requested_email as string | null),
        folderNames: ((r.folder_ids as string[]) ?? []).map((id) => folderNameById.get(id) ?? 'Unknown folder'),
        documentNames: ((r.document_ids as string[]) ?? []).map((id) => docNameById.get(id) ?? 'Unknown document'),
        pendingItemCount: pendingItemsByRequest.get(r.id as string) ?? 0,
        requestedAt: r.requested_at as string,
      };
    }),
  });
}
