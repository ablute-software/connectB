// Prompt 904 — what founder_incubator_relationships() and founder_incubator_access_log() answer, for ONE
// org, read straight from the tables with the service role. Those two SQL functions are written as
// "every programme of the orgs THIS SESSION belongs to" (is_org_member inside the query), so a Developer
// Viewer session — whose session belongs to the developer's own org — got the developer's programmes
// inside another startup's shell. The rows are shaped exactly like the functions' rows so the screen
// cannot tell the difference. Read-only by construction.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;

/** founder_incubator_relationships() + founder_incubator_access_log(), for one org, without the session. */
export async function viewerPrograms(admin: SupabaseClient, orgId: string): Promise<{ relationships: Row[]; accessLog: Row[] }> {
  const { data: rels } = await admin.from('incubator_relationships')
    .select('id, org_id, incubator_id, cohort_id, status, sharing_level, public_badge, started_at, graduated_at, ended_at, ended_by, end_reason')
    .eq('org_id', orgId);
  const relRows = (rels ?? []) as Row[];
  if (relRows.length === 0) return { relationships: [], accessLog: [] };

  const incubatorIds = [...new Set(relRows.map((r) => r.incubator_id as string))];
  const cohortIds = [...new Set(relRows.map((r) => r.cohort_id as string | null).filter((x): x is string => !!x))];
  const [{ data: incubators }, { data: cohorts }, { data: log }] = await Promise.all([
    admin.from('incubators').select('id, name, logo_url, kind, related_catalog_entity_id').in('id', incubatorIds),
    cohortIds.length ? admin.from('incubator_cohorts').select('id, name').in('id', cohortIds) : Promise.resolve({ data: [] as Row[] }),
    admin.from('incubator_access_log').select('id, relationship_id, member_id, surface, target_id, viewed_at')
      .in('relationship_id', relRows.map((r) => r.id as string)).order('viewed_at', { ascending: false }).limit(500),
  ]);
  const incubatorById = new Map(((incubators ?? []) as Row[]).map((i) => [i.id as string, i]));
  const cohortNameById = new Map(((cohorts ?? []) as Row[]).map((c) => [c.id as string, c.name as string]));

  // Same order as the function: live programmes first, then newest start.
  const relationships = relRows
    .map((r) => {
      const i = incubatorById.get(r.incubator_id as string) ?? {};
      return {
        relationship_id: r.id, org_id: r.org_id, incubator_id: r.incubator_id,
        incubator_name: i.name ?? null, incubator_logo_url: i.logo_url ?? null, incubator_kind: i.kind ?? null,
        incubator_also_invests: i.related_catalog_entity_id != null,
        cohort_name: r.cohort_id ? cohortNameById.get(r.cohort_id as string) ?? null : null,
        status: r.status, sharing_level: r.sharing_level, public_badge: r.public_badge,
        started_at: r.started_at, graduated_at: r.graduated_at, ended_at: r.ended_at, ended_by: r.ended_by, end_reason: r.end_reason,
      } as Row;
    })
    .sort((a, b) => Number(a.status === 'ended') - Number(b.status === 'ended') || String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')));

  const logRows = (log ?? []) as Row[];
  const memberIds = [...new Set(logRows.map((l) => l.member_id as string | null).filter((x): x is string => !!x))];
  const { data: members } = memberIds.length
    ? await admin.from('incubator_members').select('id, full_name, invited_email').in('id', memberIds)
    : { data: [] as Row[] };
  const memberById = new Map(((members ?? []) as Row[]).map((m) => [m.id as string, m]));
  const relById = new Map(relationships.map((r) => [r.relationship_id as string, r]));
  const accessLog = logRows.map((l) => {
    const m = l.member_id ? memberById.get(l.member_id as string) : undefined;
    return {
      id: l.id, relationship_id: l.relationship_id,
      incubator_name: relById.get(l.relationship_id as string)?.incubator_name ?? null,
      member_name: (m?.full_name as string | null) || (m?.invited_email as string | null) || 'Gestor',
      surface: l.surface, target_id: l.target_id, viewed_at: l.viewed_at,
    } as Row;
  });
  return { relationships, accessLog };
}
