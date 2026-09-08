// Prompt 613 §E — the team's functions: which this business needs, who covers
// them, and what to do about the ones nobody does.
//
// This replaces a count with a question worth answering. The card it stands
// in for told a founder with three named founders that he had "0 named
// person(s)" and that nobody led the technical side, while his CTO sat in
// company_people two tabs away — because the rule counted names inside team
// CLAIMS and never read the roster. Everything here reads the roster.
//
// §E.4 is the half that makes it a product: an uncovered function has two
// exits, assign it to someone already here or mark it as a hire. "Hiring:
// finance" is a normal, credible sentence for a seed company and tells an
// investor more than silence does.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { analyseTeamComposition, compositionSummary, type RoleKey, type TeamMember } from '@/lib/team-composition';
import { teamRoleCoverageAvailable } from '@/lib/team-composition-capability';

export const dynamic = 'force-dynamic';

const EMPTY = { ok: true, available: false, roles: [], summary: null as string | null };

async function context() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: member } = await admin.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member?.org_id) return null;
  return { sb, admin, orgId: member.org_id as string };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json(EMPTY);
  if (!(await teamRoleCoverageAvailable())) return NextResponse.json(EMPTY);
  const { admin, orgId } = ctx;

  const [{ data: people }, { data: org }, { data: saved }] = await Promise.all([
    admin.from('company_people').select('id, full_name, title, is_founder, commitment').eq('org_id', orgId).order('sort_order', { ascending: true }),
    admin.from('orgs').select('stage, sectors').eq('id', orgId).maybeSingle(),
    admin.from('company_role_coverage').select('role_key, person_id, hiring, note').eq('org_id', orgId),
  ]);

  // A hand-assignment overrides the title match — the founder knows who
  // actually does what, and a title is only ever a guess at it.
  const assignedByPerson = new Map<string, RoleKey[]>();
  for (const row of saved ?? []) {
    if (!row.person_id) continue;
    const id = row.person_id as string;
    assignedByPerson.set(id, [...(assignedByPerson.get(id) ?? []), row.role_key as RoleKey]);
  }

  const members: TeamMember[] = (people ?? []).map((p) => ({
    id: p.id as string,
    fullName: p.full_name as string,
    title: (p.title as string | null) ?? null,
    isFounder: !!p.is_founder,
    commitment: (p.commitment as 'full_time' | 'part_time' | null) ?? null,
    assignedRoles: assignedByPerson.get(p.id as string),
  }));

  const orgRow = (org ?? null) as { stage?: string | null; sectors?: string[] | null } | null;
  const coverage = analyseTeamComposition(members, { stage: orgRow?.stage ?? null, sectors: orgRow?.sectors ?? [] });

  const hiringByRole = new Set((saved ?? []).filter((r) => r.hiring).map((r) => r.role_key as string));
  const roles = coverage.map((c) => ({
    key: c.role.key,
    label: c.role.label,
    why: c.role.why,
    // A function the founder has marked as a hire is not an open question any
    // more — it is a stated plan, and the card says so instead of nagging.
    state: hiringByRole.has(c.role.key) && c.state === 'absent' ? ('hiring' as const) : c.state,
    owners: c.owners,
    note: hiringByRole.has(c.role.key) && c.state === 'absent'
      ? 'Marked as a hire for this round.'
      : c.note,
  }));

  return NextResponse.json({
    ok: true,
    available: true,
    roles,
    summary: compositionSummary(coverage),
    people: members.map((m) => ({ id: m.id, fullName: m.fullName, title: m.title })),
  });
}

export async function POST(req: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { sb, admin, orgId } = ctx;
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  if (!(await teamRoleCoverageAvailable())) {
    return NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' }, { status: 200 });
  }

  const body = await req.json().catch(() => ({})) as { roleKey?: string; personId?: string | null; hiring?: boolean; clear?: boolean };
  const roleKey = (body.roleKey ?? '').trim();
  if (!roleKey) return NextResponse.json({ ok: false, error: 'A role is required.' }, { status: 400 });

  if (body.clear) {
    await admin.from('company_role_coverage').delete().eq('org_id', orgId).eq('role_key', roleKey);
    return NextResponse.json({ ok: true });
  }

  const personId = body.personId ?? null;
  const hiring = !!body.hiring;
  // The table's own CHECK says the same thing; saying it here too means the
  // founder gets a sentence instead of a constraint violation.
  if (!personId && !hiring) {
    return NextResponse.json({ ok: false, error: 'Pick someone, or mark it as a hire.' }, { status: 400 });
  }
  if (personId) {
    const { data: person } = await admin.from('company_people').select('id').eq('id', personId).eq('org_id', orgId).maybeSingle();
    if (!person) return NextResponse.json({ ok: false, error: 'That person is not on this team.' }, { status: 400 });
  }

  const { error } = await admin.from('company_role_coverage')
    .upsert({ org_id: orgId, role_key: roleKey, person_id: personId, hiring }, { onConflict: 'org_id,role_key' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
