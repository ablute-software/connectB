// Prompt I-01b §B — the founder-side incubator actions (accept/decline an
// invite, sharing level, public badge, end) are owner/admin acts
// (permissions.ts: manage_programs). One gate for the five routes; the SQL
// functions re-check the same rule (incubator_caller_org_can_manage), because
// they are security definer and callable directly.
import 'server-only';
import { NextResponse } from 'next/server';
import { serverClient, authEnabled, getOrgRole } from './supabase-server';
import { assertNotViewer } from './developer-viewer';
import { can, type OrgRole } from './permissions';
import { PROGRAMS_READ_ONLY_NOTE } from './incubators';

type Sb = Awaited<ReturnType<typeof serverClient>>;

export interface FounderProgramGate { sb: Sb; userId: string; orgRole: OrgRole | null }

// `allowNoOrg`: accept/decline may come from someone with no startup yet —
// the SQL function answers that case itself (no_open_org / declines for
// themselves). Every other action needs an org and the capability.
export async function requireProgramManager(req: Request, opts: { allowNoOrg?: boolean } = {}): Promise<FounderProgramGate | { error: NextResponse }> {
  if (!authEnabled) return { error: NextResponse.json({ ok: false, demo: true, error: 'not configured' }) };
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'not_signed_in' }, { status: 401 }) };
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return { error: viewerBlock };
  const orgRole = (await getOrgRole(user.id, sb)) as OrgRole | null;
  if (orgRole === null && opts.allowNoOrg) return { sb, userId: user.id, orgRole };
  if (!can(orgRole, 'manage_programs')) {
    return { error: NextResponse.json({ ok: false, error: 'not_org_admin', message: PROGRAMS_READ_ONLY_NOTE }, { status: 403 }) };
  }
  return { sb, userId: user.id, orgRole };
}
