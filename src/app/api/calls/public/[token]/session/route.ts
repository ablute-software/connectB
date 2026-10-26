// Prompt 907 (I1) — "who am I on this call's link?" The page asks it once it has the call's header, to decide what to show below it:
//   not signed in            -> the registration box (and "Already have an account? Sign in");
//   signed in, no startup    -> the startup step (name and country) before the form — e.g. an account that is only an investor's;
//   signed in with a startup -> the application (a draft to continue, a submitted one to look at, or a new one to start).
//   signed in and on the call's team -> `onTeam: true`, and the page says "You are on this call's team, so you cannot apply to it.";
// It NEVER says whether an email has an account (it only talks about the person who is signed in). Public path on purpose: a person
// who is not signed in gets `authenticated: false`, not a redirect to the login page.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { resolveActingOrg, withActingOrg } from '@/lib/acting-org';
import { resolvePublicCall, serviceClient } from '@/lib/calls/applicant/link';
import { isOnCallTeam } from '@/lib/calls/team-store';

export const dynamic = 'force-dynamic';

export const GET = withActingOrg(async function GET(req: Request, { params }: { params: { token: string } }) {
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ ok: false }, { status: 404 });
  const found = await resolvePublicCall(admin, params.token);
  if (!found) return NextResponse.json({ ok: false }, { status: 404 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: true, authenticated: false, hasStartup: false });

  const acting = await resolveActingOrg(req, user, sb);
  // On the call's team: never "Applying as…" — the page says so instead (Prompt 918, Adenda 3). Whatever else the person is (a startup member, a founder), and whatever the call's state.
  if (await isOnCallTeam(admin, found.call.id, user.id)) return NextResponse.json({ ok: true, authenticated: true, hasStartup: !!acting.orgId, onTeam: true, email: user.email ?? null });
  if (!acting.orgId) return NextResponse.json({ ok: true, authenticated: true, hasStartup: false, email: user.email ?? null });

  const { data: org } = await admin.from('orgs').select('name').eq('id', acting.orgId).maybeSingle();
  // The startup's application(s) on this call, drafts first: what to continue, or what to look at.
  const { data: apps } = await admin.from('call_applications').select('id, status, reference, last_page, updated_at')
    .eq('call_id', found.call.id).eq('startup_org_id', acting.orgId).neq('status', 'withdrawn').order('updated_at', { ascending: false });
  const rows = (apps ?? []) as { id: string; status: string; reference: string | null; last_page: number | null }[];
  const draft = rows.find((r) => r.status === 'draft') ?? null;
  const submitted = rows.filter((r) => r.status === 'submitted');
  return NextResponse.json({
    ok: true, authenticated: true, hasStartup: true, readOnly: acting.mode === 'viewer',
    email: user.email ?? null,
    startupName: (org as { name?: string } | null)?.name ?? null,
    application: draft ? { id: draft.id, status: 'draft', reference: draft.reference, lastPage: draft.last_page }
      : submitted[0] ? { id: submitted[0].id, status: 'submitted', reference: submitted[0].reference, lastPage: null } : null,
    submittedCount: submitted.length,
    allowMultiple: found.call.allowMultiple,
  });
});
