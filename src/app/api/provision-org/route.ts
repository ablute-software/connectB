// Provision a new founder's org + owner membership using the service role.
// Idempotent: if the user already owns an org, it is returned unchanged.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isAbluteTeamEmail, serverClient } from '@/lib/supabase-server';
import { ABLUTE_ORG_ID } from '@/lib/ablute-org';
import { logAdminAction } from '@/lib/audit';
import { PRESET_MATERIALS_FOLDERS, PRESET_DATA_ROOM_FOLDERS } from '@/lib/vault-preset-folders';
import { acquisitionSourceAvailable } from '@/lib/acquisition-source-capability';
import { isEmailBlocked, BLOCKED_EMAIL_ERROR } from '@/lib/blocked-emails-server';
import { findActorIdByOrgId, materializeEmailInvitesForNewActor } from '@/lib/network-db';

// Prompt 335 §D1 — the cold-start hook: a brand-new founder's own email may
// already have pending network_email_invites rows (someone invited them by
// email before they ever signed up). network_actors gets its row from the
// orgs-insert trigger (migration 0209) automatically, so by the time this
// runs there IS an actor to materialize the real network_invites row
// against. Best-effort only, same discipline as the platform_admin grant
// above — this must never block or fail a sign-up.
async function materializeNetworkInvitesIfAny(admin: SupabaseClient, orgId: string, email: string | undefined) {
  if (typeof email !== 'string') return;
  try {
    const actorId = await findActorIdByOrgId(admin, orgId);
    if (actorId) await materializeEmailInvitesForNewActor(admin, email, actorId);
  } catch { /* never blocks sign-up */ }
}

// The platform owner. Signing up with one of these specific, hardcoded
// addresses links to the real ablute_ org (already seeded) as owner AND
// grants back-office (developer) access — so the owner gets full founder +
// back-office capabilities from a single sign-up.
//
// Prompt 531 — sherlockdeal.com@gmail.com REMOVED from this list. It was
// added when the project account moved to that address, on the reasoning
// that a single constant would silently produce an ordinary founder with an
// empty org and no back-office. That reasoning is now obsolete: the address
// is used as an ordinary test inbox (it receives the real magic links for
// verification fixtures), so a signup with it must NOT silently acquire
// ownership of the real ablute_ org and platform_admin. The existing owner
// account keeps its access through the platform_admins rows it already has
// — this constant only ever decides what a NEW signup gets.
//
// Ordering note (Prompt 538): this removal must be deployed with, or
// before, making /api/provision-org reachable at the middleware. Until that
// fix, provisioning never ran at signup time at all; after it, a fresh
// signup with this address would have been provisioned straight into the
// ablute_ org as owner. Same deploy, this commit first.
const OWNER_EMAILS = ['ablutecompany@gmail.com'];

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const {
    user_id, org_name,
    website, sector, stage, round_target_eur, country, one_liner,
    full_name, title, phone, linkedin_url,
    acquisition_source, acquisition_source_detail,
    // Prompt 404 §B.2 — the founder's own newsletter consent (migration
    // 0255, on org_members — see that migration's own comment for why not
    // `people`).
    marketing_opt_in,
  } = await req.json();
  if (!user_id || !org_name) return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
  if (!full_name || !title) return NextResponse.json({ ok: false, error: 'full_name and title/cargo are required' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // The request body's `email` field is never used for this decision — it's
  // whatever the signup form sent, unverified. The email that actually
  // decides ownership/domain-admin comes from auth.users itself, via the
  // service role, which is also the only place email_confirmed_at lives.
  const { data: authUser } = await admin.auth.admin.getUserById(user_id);
  const email = authUser?.user?.email;
  const emailConfirmed = !!authUser?.user?.email_confirmed_at;

  // BUG-SEG-1 — this route used to trust `user_id` from the request body
  // outright: an unauthenticated caller could supply any account's id and
  // have it linked as owner of a new org, or (if that account's real email
  // happens to be an OWNER_EMAILS/@ablute.pt address) linked into the real
  // ablute_ org and granted platform_admin. Two legitimate callers reach
  // this route: (a) signup with email confirmation off/instant, where the
  // client already has a session by the time this request lands — checked
  // strictly below; (b) signup where Supabase requires email confirmation
  // first, so `signUp()` returns no session at all until the link is
  // clicked (confirmed against production auth.users: real founder signups
  // show confirm delays of tens of seconds to minutes, not zero) — there is
  // genuinely no session cookie to check yet in that case. For that path,
  // the compensating control is that the target account must have just been
  // created; an attacker supplying a pre-existing account they don't hold a
  // session for is rejected either way.
  const sb = await serverClient();
  const { data: { user: caller } } = await sb.auth.getUser();
  if (caller) {
    if (caller.id !== user_id) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  } else {
    const createdAt = authUser?.user?.created_at ? new Date(authUser.user.created_at).getTime() : 0;
    const freshEnough = createdAt > 0 && Date.now() - createdAt < 10 * 60 * 1000;
    if (!freshEnough) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  // Prompt 244/245 — the auth.users row for this email may already exist
  // (signUp() runs client-side, before this route ever sees the request);
  // this can't undo that, but it stops a blocked address from getting an
  // org, ownership, or platform_admin out of it.
  if (typeof email === 'string' && await isEmailBlocked(admin, email)) {
    return NextResponse.json({ ok: false, error: BLOCKED_EMAIL_ERROR }, { status: 403 });
  }

  const isLegacyOwner = typeof email === 'string' && OWNER_EMAILS.includes(email.trim().toLowerCase());
  // Hard requirement (DECISIONS.md): the @ablute.pt domain grant only ever
  // applies once Supabase has confirmed the address — never on the strength
  // of a just-submitted signup form alone. The two legacy OWNER_EMAILS are
  // pre-vetted, hardcoded, known accounts and don't carry this restriction —
  // that's a different, narrower trust decision than "anyone who can receive
  // mail at this whole domain."
  const isAbluteTeam = emailConfirmed && isAbluteTeamEmail(email);
  const isOwner = isLegacyOwner || isAbluteTeam;
  const profileFields = { full_name, title, phone: phone || null, linkedin_url: linkedin_url || null, marketing_opt_in: !!marketing_opt_in };

  // Owner always gets platform (back-office) access — best effort, never
  // blocks sign-up. Prompt 43/44: this used to swallow a failure silently
  // (`catch { /* ignore */ }`) — a confirmed @ablute.pt teammate could fail
  // to get backoffice access with nothing to show for it. Still never
  // blocks sign-up (the outer flow continues either way — is_platform_admin()
  // also has the domain-based fallback now, see migration 0050), but a
  // failure here is at least visible in admin_audit_log instead of invisible.
  if (isOwner) {
    const { error: adminGrantErr } = await admin.from('platform_admins').upsert({ user_id }, { onConflict: 'user_id' });
    if (adminGrantErr) {
      try {
        await logAdminAction(admin, {
          adminUserId: user_id, action: 'platform_admin_grant_failed', subjectType: 'user',
          subjectId: user_id, detail: { email, error: adminGrantErr.message },
        });
      } catch { /* logging itself must never block sign-up either */ }
    }
  }

  const { data: existing } = await admin.from('org_members').select('org_id').eq('user_id', user_id).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, org_id: existing.org_id, already: true });

  // Owner joins the existing seeded ablute_ org as owner rather than a fresh empty org.
  // Revisited for Phase 2: the owner's own org (ablute_) already has a real 15-entity
  // pipeline — onboarding's startup-detail fields don't apply to them, only their own
  // person profile does. Multi-org platform-admin management is a later concern.
  if (isOwner) {
    const { error: linkErr } = await admin.from('org_members').insert({ org_id: ABLUTE_ORG_ID, user_id, role: 'owner', ...profileFields });
    if (!linkErr) {
      await materializeNetworkInvitesIfAny(admin, ABLUTE_ORG_ID, email);
      return NextResponse.json({ ok: true, org_id: ABLUTE_ORG_ID, owner: true });
    }
    // If linking failed for any reason, fall through to creating a normal org.
  }

  // Prompt 124 C1 — acquisition_source/detail only included in the insert
  // once the column exists (capability-gated), so this insert never fails
  // pre-migration with an unknown-column error.
  const acquisitionFields = await acquisitionSourceAvailable()
    ? { acquisition_source: acquisition_source || null, acquisition_source_detail: acquisition_source_detail || null }
    : {};
  const { data: org, error: orgErr } = await admin
    .from('orgs')
    .insert({
      name: org_name, sender_email: email,
      website: website || null, sector: sector || null, stage: stage || null,
      round_target_eur: round_target_eur || null, country: country || null, one_liner: one_liner || null,
      ...acquisitionFields,
    })
    .select('id')
    .single();
  if (orgErr) return NextResponse.json({ ok: false, error: orgErr.message }, { status: 500 });

  const { error: memErr } = await admin.from('org_members').insert({ org_id: org.id, user_id, role: 'owner', ...profileFields });
  if (memErr) return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 });

  // Seed default folders so a new founder has a data room to work with immediately.
  await admin.from('folders').insert([
    ...PRESET_MATERIALS_FOLDERS.map((name, i) => ({ org_id: org.id, name, kind: 'materials', position: i + 1 })),
    ...PRESET_DATA_ROOM_FOLDERS.map((name, i) => ({ org_id: org.id, name, kind: 'data_room', position: i + 11 })),
  ]);

  await materializeNetworkInvitesIfAny(admin, org.id, email);
  return NextResponse.json({ ok: true, org_id: org.id });
}
