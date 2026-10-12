// Prompt I-01 §C.4 — Founder › Definições › Programas: every relationship of
// the caller's org (founder_incubator_relationships(): only the incubator
// fields the screen shows; D3 as a boolean) and "Quem consultou"
// (founder_incubator_access_log()).
//
// Prompt 904 — both functions answer "the orgs THIS SESSION is a member of"
// (is_org_member(r.org_id) inside the SQL), so in a Developer Viewer session they
// returned the developer's OWN org's programmes — the "ALEX trial — Ended 01 Oct"
// row of ablute_ showing inside another startup's shell. A viewer session reads the
// same tables for the VIEWED org instead (lib/incubator-programs-viewer.ts), shaped
// exactly like the two functions' rows. Member sessions are untouched: same two RPCs.
import { NextResponse } from 'next/server';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { actingReader, resolveActingOrg, withActingOrg } from '@/lib/acting-org';
import { viewerPrograms } from '@/lib/incubator-programs-viewer';

// Per-user, per-request data: never prerendered (an env-less build would
// otherwise freeze the not-configured answer into a static file).
export const dynamic = 'force-dynamic';

export const GET = withActingOrg(async function GET(req: Request) {
  if (!authEnabled) return NextResponse.json({ ok: false, demo: true, error: 'not configured' });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_signed_in' }, { status: 401 });

  const acting = await resolveActingOrg(req, user, sb);
  if (acting.mode === 'viewer' && acting.orgId) {
    const { relationships, accessLog } = await viewerPrograms(actingReader(acting, sb), acting.orgId);
    return NextResponse.json({ ok: true, available: true, relationships, accessLog });
  }

  const [rels, log] = await Promise.all([
    sb.rpc('founder_incubator_relationships'),
    sb.rpc('founder_incubator_access_log'),
  ]);
  // Before the migration is applied the functions do not exist: an empty
  // section, never an error on the founder's settings page.
  if (rels.error) return NextResponse.json({ ok: true, available: false, relationships: [], accessLog: [] });
  return NextResponse.json({ ok: true, available: true, relationships: rels.data ?? [], accessLog: log.data ?? [] });
});
