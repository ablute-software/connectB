// Prompt 330 §B — Pipeline's "+Add" flow: invite a founder you already
// personally know by email. This deliberately does NOT extend
// /api/network/invite's toActorId contract — that route's whole shape
// assumes the recipient is already a resolvable actorId (a suggestion, a
// connection, someone the UI already surfaced). Here the founder only has
// an email, so this route resolves email -> org -> actor itself, and fails
// honestly (never a fabricated contact, never an invite sent outside the
// product) when no account exists yet.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId, countPendingInvitesFrom, createInvite, findOrgByMemberEmail, findActorIdByOrgId } from '@/lib/network-db';
import { canSendInvite } from '@/lib/network';

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
  const email = body.email?.trim();
  const message = body.message?.trim();
  if (!email) return NextResponse.json({ ok: false, error: 'Missing email.' }, { status: 400 });
  if (!message) return NextResponse.json({ ok: false, error: 'A short note on how you know them is required.' }, { status: 400 });

  const org = await findOrgByMemberEmail(admin, email);
  if (!org) {
    // Honest, not opaque — and NOT a 4xx/error: this is a normal, expected
    // outcome (the target just hasn't signed up yet), never a failure the
    // UI should render as if something went wrong.
    return NextResponse.json({ ok: true, found: false, message: "We couldn't find an account with that email on Sherlock Deal yet." });
  }

  const toActorId = await findActorIdByOrgId(admin, org.orgId);
  if (!toActorId) return NextResponse.json({ ok: false, error: 'Could not resolve that account.' }, { status: 500 });
  if (toActorId === actor.actorId) return NextResponse.json({ ok: false, error: "You can't invite yourself." }, { status: 400 });

  const pendingCount = await countPendingInvitesFrom(admin, actor.actorId);
  if (!canSendInvite(pendingCount)) {
    return NextResponse.json({ ok: false, error: 'You already have 5 pending invites out — wait for one to be answered before sending another.' });
  }

  const result = await createInvite(admin, {
    fromActorId: actor.actorId, toActorId, contextKind: 'direct_known', contextRef: org.orgName, message,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({ ok: true, found: true, invite: result.invite });
}
