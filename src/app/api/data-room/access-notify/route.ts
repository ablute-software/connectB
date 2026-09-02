// Prompt 530 — the one notification a data-room access CHANGE should send.
//
// Until now the only automatic email in this area was the guest invite
// itself (/api/data-room/guest-invite): granting three more documents to an
// investor who already had access, or extending an expiring grant, told the
// recipient nothing at all. This route closes that, deliberately as a thin
// layer over the SAME infrastructure — sendTransactionalEmail +
// transactionalTemplate (lib/resend.ts) — not a second notification system,
// and it never writes a grant, a person or a relationship of its own.
//
// One call = one email, however many documents were added: the founder's
// single "Grant access" click must not turn into 60 messages.
//
// Security: org-membership is checked against the caller's own session, and
// the recipient must ALREADY hold a non-revoked grant in this org. That
// second check is what stops this route being a way to send mail to
// arbitrary addresses through the product's own domain.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { ensureGuestToken } from '@/lib/guest-token-server';
import { resendConfigured, sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { isEmailBlocked, BLOCKED_EMAIL_ERROR } from '@/lib/blocked-emails-server';
import { APP_URL } from '@/lib/brand';

type Change = 'documents_added' | 'validity_extended';

const RESOLVE_RETRIES = 4;
const RESOLVE_DELAY_MS = 300;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Founder-private performance data never reaches an investor-facing
// surface, and an email is one (CLAUDE.md root rule). What goes out here is
// strictly the recipient's OWN access: how many files they can now open,
// their names, and until when. No pipeline stats, no counts about other
// investors, nothing derived about the founder.
function bodyFor(change: Change, orgName: string, opts: { documentNames: string[]; documentCount: number; expiresAt?: string }): { heading: string; body: string } {
  if (change === 'validity_extended') {
    return {
      heading: `${orgName} extended your data room access`,
      body: `Your access to the files ${orgName} shared with you has been extended`
        + (opts.expiresAt ? ` until ${formatDate(opts.expiresAt)}` : ' and no longer has an end date')
        + '.',
    };
  }
  const named = opts.documentNames.slice(0, 5).map((n) => `<li>${escapeHtml(n)}</li>`).join('');
  const more = opts.documentCount - Math.min(opts.documentNames.length, 5);
  return {
    heading: `${orgName} shared more files with you`,
    body: `${orgName} has added ${opts.documentCount} ${opts.documentCount === 1 ? 'file' : 'files'} to what you can see in their data room.`
      + (named ? `<br/><br/><ul style="margin:0;padding-left:18px;">${named}${more > 0 ? `<li>and ${more} more</li>` : ''}</ul>` : ''),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const body = await req.json().catch(() => ({})) as {
    orgId?: string; email?: string; change?: Change; documentNames?: string[]; documentCount?: number; expiresAt?: string;
  };
  const orgId = body.orgId;
  const email = body.email?.trim().toLowerCase();
  const change = body.change;
  if (!orgId || !email) return NextResponse.json({ ok: false, error: 'orgId and email are required.' }, { status: 400 });
  if (change !== 'documents_added' && change !== 'validity_extended') {
    return NextResponse.json({ ok: false, error: 'Unknown change type.' }, { status: 400 });
  }

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', orgId).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  if (await isEmailBlocked(admin, email)) {
    return NextResponse.json({ ok: false, error: BLOCKED_EMAIL_ERROR }, { status: 403 });
  }

  // The recipient must already be someone this org has granted something
  // to — either directly by email, or as a person whose record carries it.
  // Separate .eq() queries rather than one .or() string: an address is
  // caller-supplied text and PostgREST's `or` filter is parsed, not
  // parameterised — a comma or parenthesis in it would change the filter,
  // not just fail to match.
  //
  // The store's addGrant is a fire-and-forget browser insert, so the very
  // first grant of a relationship can still be in flight when this call
  // lands — the same race /api/data-room/guest-invite already retries for.
  type EmailGrant = { id: string; invited_email: string | null; confirmed_at: string | null };
  let emailGrants: EmailGrant[] = [];
  let hasRelationship = false;
  for (let attempt = 0; attempt < RESOLVE_RETRIES && !hasRelationship; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RESOLVE_DELAY_MS));
    const [{ data: invited }, { data: grantee }] = await Promise.all([
      admin.from('access_grants').select('id, invited_email, confirmed_at')
        .eq('org_id', orgId).is('revoked_at', null).eq('invited_email', email),
      admin.from('access_grants').select('id, invited_email, confirmed_at')
        .eq('org_id', orgId).is('revoked_at', null).eq('grantee_email', email),
    ]);
    emailGrants = [...(invited ?? []), ...(grantee ?? [])] as EmailGrant[];
    hasRelationship = emailGrants.length > 0;
    if (hasRelationship) break;

    const [{ data: verified }, { data: guessed }] = await Promise.all([
      admin.from('people').select('id').eq('org_id', orgId).eq('email_verified', email),
      admin.from('people').select('id').eq('org_id', orgId).eq('email_guess', email),
    ]);
    const personIds = [...new Set([...(verified ?? []), ...(guessed ?? [])].map((p) => p.id as string))];
    if (personIds.length > 0) {
      const { data: personGrants } = await admin.from('access_grants').select('id')
        .eq('org_id', orgId).is('revoked_at', null).in('person_id', personIds).limit(1);
      hasRelationship = (personGrants ?? []).length > 0;
    }
  }
  if (!hasRelationship) {
    return NextResponse.json({ ok: false, error: 'That address has no access in this data room.' }, { status: 404 });
  }

  if (!resendConfigured) {
    return NextResponse.json({ ok: true, emailSent: false, emailError: 'Email sending is not available in your workspace yet.' });
  }

  const { data: org } = await admin.from('orgs').select('name').eq('id', orgId).maybeSingle();
  const orgName = (org?.name as string | undefined) ?? 'A startup';

  // A recipient who has not confirmed an account yet only has one usable
  // door: their guest-preview link. ensureGuestToken hands back the SAME
  // token the founder may already have shared — this route never mints a
  // second link for the same relationship. A confirmed recipient goes to
  // the portal they signed into.
  const stillGuest = emailGrants.some((g) => g.invited_email && !g.confirmed_at);
  let ctaUrl = `${APP_URL}/portal`;
  let ctaLabel = 'Open your data room';
  let footer: string | undefined;
  if (stillGuest) {
    const minted = await ensureGuestToken(admin, orgId, email);
    if (minted.ok && minted.token) {
      ctaUrl = `${APP_URL}/guest/${minted.token}`;
      ctaLabel = 'View data room';
      if (minted.expiresAt) footer = `This link expires on ${formatDate(minted.expiresAt)}.`;
    }
  }

  const documentNames = (body.documentNames ?? []).filter((n) => typeof n === 'string');
  const documentCount = Math.max(body.documentCount ?? documentNames.length, 1);
  const { heading, body: html } = bodyFor(change, orgName, { documentNames, documentCount, expiresAt: body.expiresAt });

  const result = await sendTransactionalEmail({
    to: email,
    subject: heading,
    html: transactionalTemplate({ heading, body: html, ctaLabel, ctaUrl, footer }),
    context: { orgId, kind: 'access_notify' },
  });

  return NextResponse.json({
    ok: true,
    emailSent: result.sent,
    emailError: result.sent ? undefined : 'Could not send the notification email to this recipient.',
  });
}
