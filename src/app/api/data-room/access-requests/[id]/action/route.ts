// Item 1 (Lote E) step 5 — founder grants or declines a pending
// access_requests row. Grant creates real access_grants rows (one per
// folder_id/document_id on the request — same shape submitGrantTree already
// writes for a manual grant) and flips the request to 'granted'; decline
// just flips it to 'declined'. Both are terminal — a request never goes
// back to 'pending' from either (re-requesting is a NEW row, via
// /api/portal/access-requests's existing "Request again").
//
// Auth reads the org membership off the REQUEST's own org_id, not a
// client-supplied one — a caller can't point this at an org they don't
// belong to just by passing a different id in the body.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resendConfigured, sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { isEmailBlocked, BLOCKED_EMAIL_ERROR } from '@/lib/blocked-emails-server';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const body = await req.json().catch(() => ({})) as { action?: 'grant' | 'decline' };
  if (body.action !== 'grant' && body.action !== 'decline') {
    return NextResponse.json({ ok: false, error: 'action must be "grant" or "decline".' }, { status: 400 });
  }

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: reqRow } = await admin.from('access_requests').select('*').eq('id', params.id).maybeSingle();
  if (!reqRow) return NextResponse.json({ ok: false, error: 'Request not found.' }, { status: 404 });
  if (reqRow.status !== 'pending') return NextResponse.json({ ok: false, error: `Already ${reqRow.status as string}.` }, { status: 409 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', reqRow.org_id as string).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const { data: org } = await admin.from('orgs').select('name').eq('id', reqRow.org_id as string).single();

  if (body.action === 'grant') {
    const folderIds = (reqRow.folder_ids as string[]) ?? [];
    const documentIds = (reqRow.document_ids as string[]) ?? [];
    if (folderIds.length === 0 && documentIds.length === 0) {
      return NextResponse.json({ ok: false, error: 'This request has no folders or documents to grant.' }, { status: 409 });
    }
    // Prompt 244/245 — only the invited_email path (no known person_id yet)
    // grants a NEW email real access; a person_id already belongs to a
    // known, existing member and isn't this check's concern.
    const requestedEmail = reqRow.person_id ? null : (reqRow.requested_email as string | null);
    if (requestedEmail && await isEmailBlocked(admin, requestedEmail)) {
      return NextResponse.json({ ok: false, error: BLOCKED_EMAIL_ERROR }, { status: 403 });
    }
    // No expires_at guess here — this re-grants whatever the request asked
    // for with no expiry; the founder can set one afterward the same way
    // any other grant gets one, via the existing per-grant UI.
    const base = {
      org_id: reqRow.org_id as string,
      person_id: (reqRow.person_id as string | null) ?? null,
      // Mirrors the existing "invite" shape (documents/page.tsx's
      // submitGrantTree): no known person_id means this becomes a
      // pending_confirmation grant on invited_email, same as any other
      // externally-invited grant — not a special case.
      invited_email: reqRow.person_id ? null : (reqRow.requested_email as string | null),
      granted_at: new Date().toISOString(),
    };
    const rows = [
      ...folderIds.map((folder_id) => ({ ...base, folder_id })),
      ...documentIds.map((document_id) => ({ ...base, document_id })),
    ];
    const { error: insertError } = await admin.from('access_grants').insert(rows);
    if (insertError) return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
  }

  await admin.from('access_requests')
    .update({ status: body.action === 'grant' ? 'granted' : 'declined', responded_at: new Date().toISOString() })
    .eq('id', params.id);

  // Best-effort notify — same posture as every other portal decision route
  // (e.g. /api/portal/pipeline's interest/pass notify): a failed send never
  // undoes the decision that already committed above.
  if (resendConfigured) {
    let to: string | null = null;
    if (reqRow.person_id) {
      const { data: person } = await admin.from('people').select('email_verified').eq('id', reqRow.person_id as string).single();
      to = (person?.email_verified as string | null) ?? null;
    } else {
      to = (reqRow.requested_email as string | null) ?? null;
    }
    if (to) {
      const heading = body.action === 'grant' ? 'Access granted' : 'Access request declined';
      const emailBody = body.action === 'grant'
        ? `${(org?.name as string | undefined) ?? 'The startup'} granted the access you requested.`
        : `${(org?.name as string | undefined) ?? 'The startup'} declined the access you requested.`;
      try {
        await sendTransactionalEmail({
          to, subject: heading,
          html: transactionalTemplate({ heading, body: emailBody, ctaLabel: 'Open your workspace', ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/pipeline` }),
          context: { kind: 'access_grant' },
        });
      } catch { /* best-effort */ }
    }
  }

  return NextResponse.json({ ok: true });
}
