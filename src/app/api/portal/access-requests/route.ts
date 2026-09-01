// Investor Workspace — "Request again" on an expired access card (Prompt
// 121 §2.5/§2.6). Writes to access_requests, which does not exist until
// migration 0114 lands (PROPOSED, NOT APPLIED) — the client only renders
// the button that calls this route once /api/me's accessRequests
// capability is true, so this route is unreachable in practice until then.
// Left fully implemented (not a stub) so enabling the capability is the
// only step left once the founder applies the migration.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { grantStatus } from '@/lib/access-grants';
import { resendConfigured, sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { orgId?: string };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();

  // Re-derive which folders/documents this investor's now-expired grants for
  // this org used to cover — that's what "Request again" is asking for.
  const orParts = [`grantee_email.eq.${email}`, `invited_email.eq.${email}`];
  if (person) orParts.push(`person_id.eq.${person.id}`);
  const { data: orgGrants } = await admin.from('access_grants').select('*')
    .eq('org_id', body.orgId).is('revoked_at', null).or(orParts.join(','));
  const now = new Date();
  const expired = (orgGrants ?? []).filter((g) => grantStatus(g as never, now) === 'expired');
  if (expired.length === 0) return NextResponse.json({ ok: false, error: 'No expired access found for this startup.' }, { status: 409 });

  const folderIds = [...new Set(expired.filter((g) => g.folder_id).map((g) => g.folder_id as string))];
  const documentIds = [...new Set(expired.filter((g) => g.document_id).map((g) => g.document_id as string))];

  const { data: created, error: insertError } = await admin.from('access_requests').insert({
    org_id: body.orgId, person_id: person?.id ?? null, requested_email: person ? null : email,
    folder_ids: folderIds, document_ids: documentIds, status: 'pending',
  }).select('id').single();
  if (insertError) return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });

  // Prompt 518 §1 — the unification. Until now this route wrote ONLY the flat
  // folder_ids/document_ids arrays, which made the request a second-class
  // citizen: /documents/requests/[id] reads access_request_items, so a request
  // born here had nothing to show and the founder was left with the blind
  // Grant/Decline buttons on documents/page.tsx instead of a real review
  // screen. Migration 0290 added folder_id to the items table and backfilled
  // the pending requests that already existed; this is the other half — every
  // NEW request gets its items at creation, so the review page always resolves
  // no matter which endpoint created the request.
  //
  // Best-effort by design: the request itself is already saved and visible. If
  // this insert fails the founder still sees the request, so failing the whole
  // call here would be worse than a request that degrades to the flat lists.
  const derivedItems = [
    ...folderIds.map((folder_id) => ({ request_id: created.id as string, folder_id, status: 'pending' })),
    ...documentIds.map((document_id) => ({ request_id: created.id as string, document_id, status: 'pending' })),
  ];
  if (derivedItems.length > 0) {
    const { error: itemsError } = await admin.from('access_request_items').insert(derivedItems);
    if (itemsError) console.error('[access-requests] items insert failed', { requestId: created.id, error: itemsError.message });
  }

  if (resendConfigured) {
    const { data: org } = await admin.from('orgs').select('name, sender_email').eq('id', body.orgId).single();
    const to = (org?.sender_email as string | null) ?? null;
    if (to) {
      try {
        await sendTransactionalEmail({
          to, subject: 'An investor requested access again',
          html: transactionalTemplate({
            heading: 'Access requested again',
            body: `An investor whose access to ${org?.name ?? 'your data room'} expired has requested it again.`,
            ctaLabel: 'Review in your workspace', ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/documents`,
          }),
        });
      } catch { /* best-effort, matches every other portal notify route */ }
    }
  }

  return NextResponse.json({ ok: true });
}
