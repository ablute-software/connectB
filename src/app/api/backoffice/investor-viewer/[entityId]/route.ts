// Prompt 611 §F — what an operator sees after entering an investor firm.
//
// AN INVESTOR IS NOT AN ORG, and this route is the shape of that fact. There
// is no investor workspace to open the way a startup's is opened: the firm
// (catalog_entities) holds the pipeline, the watchlist, the relationship
// decisions and the interest levels; the PERSON holds the tasks; and the two
// are joined by matchdeal_investor_members, a (person, firm) pair. §F's own
// table says so. So this is a read-only assembly of the firm's real rows
// rather than a redirect into a shell that does not exist — stated plainly
// because "open it as they see it" cannot mean the same thing on both sides.
//
// The members' personal tasks are included, with the owner named, for the
// reason §F gives: "se ficarem de fora, o operador entra, vê um pipeline sem
// tarefa nenhuma e conclui que o investidor está parado — um diagnóstico
// errado tirado de uma vista incompleta é pior do que não ter a vista."
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { entityId: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  const entityId = params.entityId;

  const { data: firm, error: firmErr } = await admin.from('catalog_entities')
    .select('id, name, website, country, kind').eq('id', entityId).maybeSingle();
  if (firmErr) return NextResponse.json({ ok: false, error: firmErr.message }, { status: 500 });
  if (!firm) return NextResponse.json({ ok: false, error: 'Investor firm not found.' }, { status: 404 });

  const [{ data: members }, { data: admissions }, { data: watches }, { data: decisions }, { data: interest }] = await Promise.all([
    admin.from('matchdeal_investor_members')
      .select('id, user_id, status, role, created_at, domain_verified')
      .eq('catalog_entity_id', entityId).order('created_at', { ascending: true }),
    admin.from('investor_pipeline_admissions')
      .select('id, org_id, admitted_at').eq('investor_catalog_entity_id', entityId).order('admitted_at', { ascending: false }),
    admin.from('investor_watches')
      .select('id, org_id, status, requested_at, decided_at, last_seen_at').eq('investor_catalog_entity_id', entityId).order('requested_at', { ascending: false }),
    admin.from('investor_relationship_decisions')
      .select('id, org_id, decision, reason_detail, decided_at, access_revoked_count').eq('investor_catalog_entity_id', entityId).order('decided_at', { ascending: false }),
    admin.from('investor_interest_levels')
      .select('id, org_id, level, status, requested_at, decided_at, note').eq('investor_catalog_entity_id', entityId).order('requested_at', { ascending: false }),
  ]);

  // Every one of those rows names a startup by org_id and nothing else; a
  // screen full of uuids answers no question an operator has.
  const orgIds = [...new Set([
    ...(admissions ?? []).map((r) => r.org_id as string),
    ...(watches ?? []).map((r) => r.org_id as string),
    ...(decisions ?? []).map((r) => r.org_id as string),
    ...(interest ?? []).map((r) => r.org_id as string),
  ])];
  const orgNameById = new Map<string, string>();
  if (orgIds.length) {
    const { data: orgs } = await admin.from('orgs').select('id, name').in('id', orgIds);
    for (const o of orgs ?? []) orgNameById.set(o.id as string, o.name as string);
  }
  const orgName = (id: string) => orgNameById.get(id) ?? '(startup no longer exists)';

  // The seat rows carry user_id; the email lives on auth.users, and
  // investor_tasks is keyed by that email as free TEXT (see the finding at the
  // end of §F — no foreign key, so a changed address silently orphans a
  // person's tasks). One bulk listUsers, same pattern as
  // /api/backoffice/investor-accounts.
  const emailByUserId = new Map<string, string>();
  if ((members ?? []).length) {
    const { data: userList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of userList?.users ?? []) if (u.email) emailByUserId.set(u.id, u.email.toLowerCase());
  }
  const memberRows = (members ?? []).map((m) => ({
    id: m.id as string,
    userId: m.user_id as string,
    email: emailByUserId.get(m.user_id as string) ?? null,
    status: m.status as string,
    role: (m.role as string | null) ?? null,
    domainVerified: !!m.domain_verified,
    createdAt: m.created_at as string,
  }));

  const emails = memberRows.map((m) => m.email).filter((e): e is string => !!e);
  const { data: tasks } = emails.length
    ? await admin.from('investor_tasks')
      .select('id, investor_email, org_id, title, kind, due_at, done, created_at')
      .in('investor_email', emails).order('created_at', { ascending: false }).limit(200)
    : { data: [] as Record<string, unknown>[] };

  const taskOrgIds = [...new Set((tasks ?? []).map((t) => t.org_id as string).filter(Boolean))];
  for (const id of taskOrgIds) if (!orgNameById.has(id)) orgNameById.set(id, '');
  if (taskOrgIds.length) {
    const { data: orgs } = await admin.from('orgs').select('id, name').in('id', taskOrgIds);
    for (const o of orgs ?? []) orgNameById.set(o.id as string, o.name as string);
  }

  return NextResponse.json({
    ok: true,
    firm: { id: firm.id, name: firm.name, website: firm.website ?? null, country: firm.country ?? null },
    members: memberRows,
    pipeline: (admissions ?? []).map((r) => ({ id: r.id, orgId: r.org_id, orgName: orgName(r.org_id as string), admittedAt: r.admitted_at })),
    watchlist: (watches ?? []).map((r) => ({
      id: r.id, orgId: r.org_id, orgName: orgName(r.org_id as string),
      status: r.status, requestedAt: r.requested_at, decidedAt: r.decided_at, lastSeenAt: r.last_seen_at,
    })),
    decisions: (decisions ?? []).map((r) => ({
      id: r.id, orgId: r.org_id, orgName: orgName(r.org_id as string),
      decision: r.decision, reasonDetail: r.reason_detail, decidedAt: r.decided_at, accessRevokedCount: r.access_revoked_count,
    })),
    interest: (interest ?? []).map((r) => ({
      id: r.id, orgId: r.org_id, orgName: orgName(r.org_id as string),
      level: r.level, status: r.status, requestedAt: r.requested_at, decidedAt: r.decided_at, note: r.note,
    })),
    // §F — "com o dono à frente": the owner's email leads each task, because a
    // task list for a firm whose members are three different people means
    // nothing without knowing whose it is.
    tasks: (tasks ?? []).map((t) => ({
      id: t.id, ownerEmail: t.investor_email, title: t.title, kind: t.kind,
      orgName: t.org_id ? (orgNameById.get(t.org_id as string) || '(startup no longer exists)') : null,
      dueAt: t.due_at, done: !!t.done, createdAt: t.created_at,
    })),
  });
}
