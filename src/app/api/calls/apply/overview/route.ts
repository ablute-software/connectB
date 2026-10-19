// Prompt 907 (I4) — the startup's "Calls" area (spec §20): open calls, my applications, past applications. Only this startup's own data and the
// calls it may see: listed open calls (those of a test organisation only to a test account), the "closed — link only" calls it reached by their
// link, and its own applications. Nothing about any other startup's application is ever read here.
import { NextResponse } from 'next/server';
import { withActingOrg } from '@/lib/acting-org';
import { serverClient } from '@/lib/supabase-server';
import { resolveActingOrg } from '@/lib/acting-org';
import { callsMode } from '@/lib/calls/mode';
import { serviceClient } from '@/lib/calls/applicant/link';
import { rowToCall } from '@/lib/calls/mappers';
import { brandingOf } from '@/lib/calls/branding';
import { sendDraftReminders } from '@/lib/calls/applicant/notices';
import { buildOverview, type ApplicationFacts, type CallFacts } from '@/lib/calls/applicant/overview';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

export const GET = withActingOrg(async function GET(req: Request) {
  if (callsMode() === 'off') return NextResponse.json({ ok: false }, { status: 404 });
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ ok: false, error: 'not configured', demo: true }, { status: 200 });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const acting = await resolveActingOrg(req, user, sb);
  if (!acting.orgId) return NextResponse.json({ ok: true, startup: false, openCalls: [], mine: [], past: [] });

  // A draft that is less than 48 hours from its deadline is reminded now, for this person, without waiting for the daily job.
  await sendDraftReminders(admin, new Date(), { userId: user.id }).catch((e) => console.error('[calls] reminder failed:', (e as Error).message));

  const [{ data: org }, { data: apps }, { data: access }] = await Promise.all([
    admin.from('orgs').select('id, is_test').eq('id', acting.orgId).maybeSingle(),
    admin.from('call_applications').select('id, call_id, status, reference, updated_at, submitted_at').eq('startup_org_id', acting.orgId),
    admin.from('call_link_access').select('call_id').eq('org_id', acting.orgId),
  ]);
  const appRows = (apps ?? []) as Row[];
  const reachedIds = new Set(((access ?? []) as Row[]).map((r) => r.call_id as string));

  // The calls that matter: every call this startup has an application on or reached by link, and every listed one that is open or scheduled.
  const { data: listed } = await admin.from('calls').select('*').eq('visibility', 'listed').in('status', ['open', 'scheduled']);
  const wanted = new Set<string>([...appRows.map((a) => a.call_id as string), ...reachedIds]);
  const { data: others } = wanted.size > 0 ? await admin.from('calls').select('*').in('id', [...wanted]) : { data: [] };
  const callRows = new Map<string, Row>();
  for (const r of [...((listed ?? []) as Row[]), ...((others ?? []) as Row[])]) callRows.set(r.id as string, r);
  const calls = [...callRows.values()].map(rowToCall);

  const ids = calls.map((c) => c.id);
  const [{ data: fieldRows }, { data: firms }, { data: incs }] = await Promise.all([
    ids.length ? admin.from('call_form_fields').select('call_id').in('call_id', ids) : Promise.resolve({ data: [] }),
    admin.from('catalog_entities').select('id, name, is_test').in('id', calls.filter((c) => c.promoterKind === 'catalog_entity').map((c) => c.promoterId)),
    admin.from('incubators').select('id, name, is_test').in('id', calls.filter((c) => c.promoterKind === 'incubator').map((c) => c.promoterId)),
  ]);
  const withForm = new Set(((fieldRows ?? []) as Row[]).map((r) => r.call_id as string));
  const promoters = new Map<string, { name: string; isTest: boolean }>();
  for (const r of [...((firms ?? []) as Row[]), ...((incs ?? []) as Row[])]) promoters.set(r.id as string, { name: (r.name as string) ?? 'An organisation', isTest: r.is_test === true });

  const branding = await brandingOf(admin, calls, 'public');
  const facts: CallFacts[] = calls.map((c) => ({
    id: c.id, token: c.linkToken, name: c.name, promoter: promoters.get(c.promoterId)?.name ?? 'An organisation', status: c.status, opensAt: c.opensAt, closesAt: c.closesAt, timezone: c.timezone,
    description: c.description, visibility: c.visibility, promoterIsTest: promoters.get(c.promoterId)?.isTest === true, hasForm: withForm.has(c.id), allowMultiple: c.allowMultiple,
    logoUrl: branding.get(c.id)?.logoUrl ?? null,
  }));
  const appFacts: ApplicationFacts[] = appRows.map((a) => ({
    id: a.id as string, callId: a.call_id as string, status: a.status as ApplicationFacts['status'], reference: (a.reference as string | null) ?? null,
    updatedAt: (a.updated_at as string) ?? '', submittedAt: (a.submitted_at as string | null) ?? null,
  }));
  const overview = buildOverview({ calls: facts, apps: appFacts, linkAccess: reachedIds, viewerIsTestAccount: (org as Row | null)?.is_test === true });
  return NextResponse.json({ ok: true, startup: true, ...overview });
});
