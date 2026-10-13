// Prompt 906 §B — edit and delete a round update.
//
// The 07/10 report (ABOUT FOOD): an update was published twice by accident, 41 seconds apart, and the card had
// no way to edit or remove either. Until now this resource only had GET and POST (../route.ts).
//
//   PATCH   title and/or body. The database trigger stamps updated_at when — and only when — one of them really
//           changes; the investor feed then says "edited <date>". NO notification is sent for an edit (the
//           investors who were emailed on publish are not emailed again).
//   DELETE  removes the row: it disappears from the founder's list and from every investor's feed. Nothing is
//           sent for a delete either; an investor who already got the email keeps it.
//
// Both are for an owner/admin of the org or the update's author (canManageRoundUpdate), and both are refused in
// a Developer Viewer session (Prompt 904): the wrapper answers 403 viewer_read_only before the handler runs, and
// the handler refuses again on its own if it is ever reached with mode 'viewer'.
//
// The row is always looked up by BOTH its id and the acting org: an id from another org is a 404, never a 403
// that would confirm the row exists.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { resolveActingOrg, viewerReadOnlyResponse, withActingOrg } from '@/lib/acting-org';
import { canManageRoundUpdate } from '@/lib/round-updates';

type Ctx = { params: { id: string } };

const FORBIDDEN = 'Only an owner, an admin or the author of this update can change it.';

async function authorize(req: Request, id: string) {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  const acting = await resolveActingOrg(req, user, sb);
  if (!acting.orgId) return { error: NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 }) };
  if (acting.mode === 'viewer') return { error: viewerReadOnlyResponse() };

  const { data: existing } = await sb.from('round_updates').select('id, org_id, created_by')
    .eq('id', id).eq('org_id', acting.orgId).maybeSingle();
  if (!existing) return { error: NextResponse.json({ ok: false, error: 'Update not found.' }, { status: 404 }) };
  if (!canManageRoundUpdate({ role: acting.role, userId: user.id, createdBy: existing.created_by as string | null })) {
    return { error: NextResponse.json({ ok: false, error: FORBIDDEN }, { status: 403 }) };
  }
  return { sb, orgId: acting.orgId, id };
}

export const PATCH = withActingOrg(async function PATCH(req: Request, { params }: Ctx) {
  const auth = await authorize(req, params.id);
  if ('error' in auth) return auth.error;

  const input = await req.json().catch(() => ({})) as { title?: unknown; body?: unknown };
  const patch: { title?: string; body?: string } = {};
  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) return NextResponse.json({ ok: false, error: 'title can’t be empty.' }, { status: 400 });
    patch.title = input.title.trim();
  }
  if (input.body !== undefined) {
    if (typeof input.body !== 'string' || !input.body.trim()) return NextResponse.json({ ok: false, error: 'body can’t be empty.' }, { status: 400 });
    patch.body = input.body.trim();
  }
  if (patch.title === undefined && patch.body === undefined) {
    return NextResponse.json({ ok: false, error: 'Nothing to update: send a title and/or a body.' }, { status: 400 });
  }

  const { data: row, error } = await auth.sb.from('round_updates').update(patch)
    .eq('id', auth.id).eq('org_id', auth.orgId).select('*').maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  // The row was there a moment ago (authorize found it) and is gone now: someone deleted it in between.
  if (!row) return NextResponse.json({ ok: false, error: 'Update not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, update: row });
});

export const DELETE = withActingOrg(async function DELETE(req: Request, { params }: Ctx) {
  const auth = await authorize(req, params.id);
  if ('error' in auth) return auth.error;

  const { error } = await auth.sb.from('round_updates').delete().eq('id', auth.id).eq('org_id', auth.orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
