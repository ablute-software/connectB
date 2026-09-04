// Prompt 532 — "Don't know who yet? Invite by email", as ONE server
// operation (the request's Approach B).
//
// What it replaces, and why the shape had to change rather than the button:
//
// The client used to loop over the selected nodes calling store.addGrant()
// once per node. addGrant pushes the grant into React state and hands the
// Supabase insert to persist() — a helper that swallows the result into a
// console.error and is never awaited. It then immediately called
// /api/data-room/guest-invite, which looked up the pending grant by
// invited_email and RETRIED WITH SLEEPS hoping the insert had landed.
//
// Every one of those inserts was rejected by Postgres (constraint
// grant_has_grantee; see migration 0292), so the retries could never
// succeed — but nothing surfaced it: the grants stayed on screen until a
// refresh, and the "No pending invite found for that email yet." that came
// back was rendered as small grey hint text. The founder was told nothing
// had gone wrong while the entire operation had failed.
//
// Doing it in one server call fixes all three at once:
//   * persistence is KNOWN before anything else happens (§10);
//   * every grant is inserted in ONE statement, so the outcome is all-or-
//     nothing rather than "some of the 60 landed" (§12);
//   * the token is minted after that insert has already committed, so the
//     race the retries existed to paper over cannot occur (§11) — and the
//     retry loop is dropped for this path accordingly.
//
// It writes through the SAME canonical access_grants model as every other
// grant. No second permission system, no second guest mechanism.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { ensureGuestToken } from '@/lib/guest-token-server';
import { guestGrantTokenAvailable } from '@/lib/access-requests-capability';
import { resendConfigured, sendTransactionalEmail } from '@/lib/resend';
import { logEmailRenderFailure } from '@/lib/email-send-log';
import { isEmailBlocked, BLOCKED_EMAIL_ERROR } from '@/lib/blocked-emails-server';
import { buildGuestAccessEmail } from '@/lib/guest-access-email';
import { APP_URL } from '@/lib/brand';

interface NodeSelection { kind: 'doc' | 'folder'; id: string; ndaRequired?: boolean }

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    orgId?: string; email?: string; name?: string; nodes?: NodeSelection[]; expiresAt?: string | null;
  };
  const orgId = body.orgId;
  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim();
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];

  if (!orgId || !email) return NextResponse.json({ ok: false, error: 'Recipient email is required.' }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: 'That does not look like a valid email address.' }, { status: 400 });
  if (nodes.length === 0) return NextResponse.json({ ok: false, error: 'Select at least one document or folder to share.' }, { status: 400 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', orgId).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  if (await isEmailBlocked(admin, email)) {
    return NextResponse.json({ ok: false, error: BLOCKED_EMAIL_ERROR }, { status: 403 });
  }

  // Every id must belong to THIS org. The client sends ids it picked from
  // its own tree, but this route runs with the service-role key — without
  // this check a crafted request could grant a stranger access to another
  // startup's documents (§53). Authorization is decided here, from the
  // database, never from what the browser claims it selected.
  const docIds = [...new Set(nodes.filter((n) => n.kind === 'doc').map((n) => n.id))];
  const folderIds = [...new Set(nodes.filter((n) => n.kind === 'folder').map((n) => n.id))];
  const [{ data: ownedDocs }, { data: ownedFolders }] = await Promise.all([
    docIds.length ? admin.from('documents').select('id').eq('org_id', orgId).in('id', docIds) : Promise.resolve({ data: [] as { id: string }[] }),
    folderIds.length ? admin.from('folders').select('id').eq('org_id', orgId).in('id', folderIds) : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  const ownedDocIds = new Set((ownedDocs ?? []).map((d) => d.id as string));
  const ownedFolderIds = new Set((ownedFolders ?? []).map((f) => f.id as string));
  const foreign = nodes.filter((n) => (n.kind === 'doc' ? !ownedDocIds.has(n.id) : !ownedFolderIds.has(n.id)));
  if (foreign.length > 0) {
    return NextResponse.json({ ok: false, error: 'Some of the selected items no longer exist in your data room.' }, { status: 400 });
  }

  const expires_at = body.expiresAt || null;
  const grantedAt = new Date().toISOString();

  // ONE insert for every selected node. Postgres applies a multi-row INSERT
  // atomically, so either the recipient gets all of the access the founder
  // chose, or none of it and a visible error — never the silent partial
  // state where the email promises documents that were never granted (§12).
  //
  // person_id stays null and invited_email carries the recipient: this is
  // the pending-external-invitee shape, and it is exactly what migration
  // 0292 widened grant_has_grantee to accept. grantee_email is deliberately
  // NOT filled in — that column means a CONFIRMED grantee, and forging it
  // here to satisfy a constraint would promote an unconfirmed invitee into a
  // confirmed one and break grantStatus()/the guest gate (§5).
  const rows = nodes.map((n) => ({
    org_id: orgId,
    person_id: null,
    document_id: n.kind === 'doc' ? n.id : null,
    folder_id: n.kind === 'folder' ? n.id : null,
    invited_email: email,
    invited_name: name || null,
    nda_required: !!n.ndaRequired,
    expires_at,
    granted_at: grantedAt,
  }));

  const { data: inserted, error: insertError } = await admin.from('access_grants').insert(rows).select('id');
  if (insertError) {
    // The founder-facing sentence stays plain; the technical reason goes to
    // the server log. Either way this is a FAILURE — the caller does not
    // continue to a guest link or an email for access that does not exist,
    // and the client rolls its optimistic state back (§13, §82).
    console.error('[invite-by-email] grant persistence failed:', insertError.code, insertError.message);
    return NextResponse.json({
      ok: false, stage: 'grants',
      error: 'Could not save the access grants — nothing was shared. Please try again.',
    }, { status: 500 });
  }
  const grantsCreated = (inserted ?? []).length;

  // Only now, with the rows committed, is a token minted. No retries, no
  // sleeps: there is nothing left to wait for.
  if (!(await guestGrantTokenAvailable())) {
    return NextResponse.json({
      ok: true, stage: 'grants_only', grantsCreated,
      guestUrl: null, emailSent: false,
      emailError: 'Access was granted, but guest links are not available in this workspace yet.',
    });
  }

  const minted = await ensureGuestToken(admin, orgId, email);
  if (!minted.ok || !minted.token) {
    console.error('[invite-by-email] guest token could not be minted:', minted.error);
    return NextResponse.json({
      ok: true, stage: 'grants_only', grantsCreated,
      guestUrl: null, emailSent: false,
      emailError: minted.error ?? 'Access was granted, but the guest link could not be created.',
    });
  }
  const guestUrl = `${APP_URL}/guest/${minted.token}`;

  // From here on the access EXISTS and is valid. An email failure below
  // never revokes it and never deletes the link (§15) — it is reported as a
  // notification failure, with Copy guest link and Resend as the recovery.
  if (!resendConfigured) {
    return NextResponse.json({
      ok: true, stage: 'granted_not_emailed', grantsCreated, guestUrl, emailSent: false,
      emailError: 'Access granted and the guest link is ready — email sending is not configured, so send the link yourself.',
    });
  }

  const { data: org } = await admin.from('orgs').select('name').eq('id', orgId).maybeSingle();
  const startupName = (org?.name as string | undefined) ?? 'A startup';

  let rendered;
  try {
    rendered = buildGuestAccessEmail({ recipientEmail: email, invitedName: name, startupName, guestUrl, guestToken: minted.token });
  } catch (e) {
    // A template that still has a {{placeholder}} in it must not go out.
    // Prompt 537 §1 — recorded, not only console.error'd: this is the one
    // branch where no provider is ever reached, so it is also the one that
    // used to disappear completely.
    console.error('[invite-by-email] email render failed:', (e as Error).message);
    await logEmailRenderFailure({ orgId, kind: 'guest_invite' }, email, (e as Error).message);
    return NextResponse.json({
      ok: true, stage: 'granted_not_emailed', grantsCreated, guestUrl, emailSent: false,
      emailError: 'Access granted and the guest link is ready, but the invitation could not be composed. Copy the link and send it yourself.',
    });
  }

  const result = await sendTransactionalEmail({
    to: email, subject: rendered.subject, html: rendered.html, text: rendered.text,
    // Prompt 537 §1 — the exact send this prompt exists for. relatedGrantId
    // ties the row to one of the grants just created, so People & Access can
    // show the outcome on the recipient's own row.
    context: { orgId, kind: 'guest_invite', relatedGrantId: ((inserted ?? [])[0]?.id as string | undefined) ?? null },
  });
  if (!result.sent) {
    // The provider's own reason (a 403 on an unverified sender domain, say)
    // is logged as a class, never guessed at and never fixed by swapping the
    // configured sender — that is environment configuration, not this
    // route's decision.
    console.error('[invite-by-email] provider refused the send:', result.providerError ?? result.error);
    return NextResponse.json({
      ok: true, stage: 'granted_not_emailed', grantsCreated, guestUrl, emailSent: false,
      emailError: `Access granted and the guest link is ready, but the invitation email could not be delivered (${result.error}). Copy the link and send it yourself.`,
    });
  }

  return NextResponse.json({ ok: true, stage: 'sent', grantsCreated, guestUrl, emailSent: true });
}
