// Prompt 330 / Prompt 335 §D1 — invite a founder or investor you already
// personally know, by email. This is the ONE implementation of the
// direct-known mechanism — Pipeline's "Partners & colleagues" panel and My
// Network's "My contacts" panel both call this same route, never a second
// copy of the logic.
//
// Anti-enumeration (Prompt 335 §D1, explicit): the response is IDENTICAL
// whether the email belongs to an existing account or not — same message,
// same shape, always including a copyable link. For an existing account the
// link is inert once opened (the real in-app invite was already created);
// for a new one it's the actual growth loop, landing on an explainer before
// signup. Never reveals which case happened.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import {
  resolveActorId, findOrgByMemberEmail, findActorIdByOrgId, findEmailInvite, createEmailInvite, emailInviteCreatedAtsForActor,
} from '@/lib/network-db';
import { emailInviteRateCounts, canSendDirectInvite } from '@/lib/network';
import { generateRawToken, hashToken } from '@/lib/matchdeal-pairing';

const GENERIC_SENT_MESSAGE = 'Invite sent — they need to accept before you\'re connected. Share the link below too, in case they haven\'t signed up yet.';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  if (!(await networkAvailable())) return NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const actor = await resolveActorId(admin, user.id);
  if (!actor) return NextResponse.json({ ok: false, error: 'No network profile found for your account.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { email?: string; message?: string };
  const email = body.email?.trim().toLowerCase();
  const message = body.message?.trim();
  if (!email) return NextResponse.json({ ok: false, error: 'Missing email.' }, { status: 400 });
  if (!message) return NextResponse.json({ ok: false, error: 'A short note on how you know them is required.' }, { status: 400 });

  // "sem repetir convite ao mesmo email" — a legitimate, non-enumerating
  // check: it's about the FOUNDER'S OWN sending history, not the target
  // account's existence, so an accurate answer here doesn't violate
  // anti-enumeration (it says nothing about whether the email is a user).
  const existing = await findEmailInvite(admin, actor.actorId, email);
  if (existing) {
    return NextResponse.json({ ok: false, error: 'You already invited this email — check My contacts for its status.' });
  }

  // Prompt 335 §D1 — 5/day, 20/week on this actor's own OUTBOUND email
  // invites (mirrors rules.ts's outreach-cap numbers, a deliberate,
  // documented choice — see network.ts's own comment — not the same
  // constant reused).
  const createdAts = await emailInviteCreatedAtsForActor(admin, actor.actorId);
  if (!canSendDirectInvite(emailInviteRateCounts(createdAts, new Date()))) {
    return NextResponse.json({ ok: false, error: 'You\'ve reached your invite limit for now — try again tomorrow or next week.' });
  }

  const org = await findOrgByMemberEmail(admin, email);
  const toActorId = org ? await findActorIdByOrgId(admin, org.orgId) : null;
  if (toActorId === actor.actorId) {
    // The one case allowed to differ from the generic response — it's
    // feedback about the CALLER'S OWN identity, not about whether some
    // other email has an account.
    return NextResponse.json({ ok: false, error: 'That\'s your own email.' });
  }

  const rawToken = generateRawToken();
  const result = await createEmailInvite(admin, {
    fromActorId: actor.actorId, email, message, tokenHash: hashToken(rawToken), toActorId, contextKind: 'direct_known',
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });

  const origin = new URL(req.url).origin;
  return NextResponse.json({ ok: true, message: GENERIC_SENT_MESSAGE, inviteLink: `${origin}/network/invite/${rawToken}` });
}
