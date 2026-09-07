// IRM_SPEC §5/§6a — GDPR request queue for the back-office. Platform admin
// only. For each request, re-resolves matching people across every org by
// email at read time (not just the one person_id captured at submission)
// so an "erase" action can be scoped to everything actually affected.
//
// Prompt 574 §A — sorted nearest-deadline-first (gdprDueAt, shared with
// Attention and queue-summary.ts — one function, not three copies), and
// resolved rows now carry who/when/how/what-was-removed instead of just a
// status flag.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { gdprDueAt } from '@/lib/gdpr';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const role = await resolveRole(user.id, user.email, sb, user.email_confirmed_at);
  if (role !== 'developer') return NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: requests, error } = await admin
    .from('gdpr_requests')
    .select('id, person_id, claimant_name, claimant_email, claimant_user_id, kind, details, status, created_at, resolved_at, resolved_by, reviewer_notes, resolution_method, removal_summary')
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const emails = [...new Set(requests.map((r) => r.claimant_email.toLowerCase()))];
  const [{ data: matches }, { data: catalogPerson }] = await Promise.all([
    emails.length
      ? admin.from('people').select('id, full_name, org_id, email_verified').in('email_verified', emails)
      : Promise.resolve({ data: [] as { id: string; full_name: string; org_id: string; email_verified: string }[] }),
    // §A.2 — "pessoa do catálogo (nome, entidade, e-mail no catálogo)": the
    // gdpr_requests.person_id FK is to people (private, per-org — checked
    // directly, not catalog_people), so this is the same private record,
    // not a second lookup — kept as its own query only for the ONE row
    // person_id names directly, since claimant_email can match several.
    requests.some((r) => r.person_id)
      ? admin.from('people').select('id, full_name, entity_id, org_id, email_verified').in('id', requests.map((r) => r.person_id).filter((x): x is string => !!x))
      : Promise.resolve({ data: [] as { id: string; full_name: string; entity_id: string; org_id: string; email_verified: string | null }[] }),
  ]);
  const orgIds = [...new Set([...(matches ?? []).map((m) => m.org_id), ...(catalogPerson ?? []).map((m) => m.org_id)])];
  const entityIds = [...new Set((catalogPerson ?? []).map((m) => m.entity_id))];
  const [{ data: orgs }, { data: entities }, resolverEmails] = await Promise.all([
    orgIds.length ? admin.from('orgs').select('id, name').in('id', orgIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    entityIds.length ? admin.from('entities').select('id, name').in('id', entityIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    Promise.all([...new Set(requests.map((r) => r.resolved_by).filter((x): x is string => !!x))].map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      return [id, data?.user?.email ?? null] as const;
    })),
  ]);
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));
  const entityName = new Map((entities ?? []).map((e) => [e.id, e.name]));
  const resolverEmailById = new Map(resolverEmails);
  const namedPersonById = new Map((catalogPerson ?? []).map((p) => [p.id, p]));

  const enriched = requests.map((r) => {
    const named = r.person_id ? namedPersonById.get(r.person_id) : undefined;
    const due = gdprDueAt(r.created_at);
    return {
      ...r, daysLeft: due.daysLeft, overdue: due.overdue, dueLabel: due.label,
      namedPerson: named ? { id: named.id, name: named.full_name, orgName: orgName.get(named.org_id) ?? '(unknown org)', entityName: entityName.get(named.entity_id) ?? null } : null,
      // §A.2 — "se o e-mail do requerente bate com o da pessoa... é a única
      // prova de identidade que temos". null when there's no named record
      // at all to compare against (a request that only ever gave an email,
      // no person_id) — never a false positive/negative either way.
      requesterEmailMatchesRecord: named ? (named.email_verified?.toLowerCase() === r.claimant_email.toLowerCase()) : null,
      resolvedByEmail: r.resolved_by ? resolverEmailById.get(r.resolved_by) ?? null : null,
      matches: (matches ?? [])
        .filter((m) => m.email_verified?.toLowerCase() === r.claimant_email.toLowerCase())
        .map((m) => ({ personId: m.id, name: m.full_name, orgName: orgName.get(m.org_id) ?? '(unknown org)' })),
    };
  });

  // Nearest-deadline-first, per §A.1 — pending only matters for sort
  // priority (a resolved request has no deadline pressure left), so it
  // sorts to the end regardless of its now-meaningless daysLeft.
  enriched.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    if (a.status === 'pending') return a.daysLeft - b.daysLeft;
    return b.created_at.localeCompare(a.created_at);
  });

  return NextResponse.json({ ok: true, requests: enriched });
}
