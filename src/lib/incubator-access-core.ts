// Prompt I-01 §B.3 — the pure half of the single incubator gate. No
// 'server-only' import so vitest can exercise it with a fake client; the
// server entry point is incubator-access.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasLiveAccess, type MemberRole, type RelationshipStatus } from './incubators';

export interface IncubatorMember {
  id: string;
  incubatorId: string;
  role: MemberRole;
  incubatorName: string;
}

export interface IncubatorAccess {
  member: IncubatorMember;
  relationship: { id: string; orgId: string; status: RelationshipStatus; sharingLevel: number };
  level: number;
}

type MemberRow = {
  id: string; incubator_id: string; role: MemberRole; created_at: string;
  incubators: { name: string; closed_at: string | null } | { name: string; closed_at: string | null }[] | null;
};

function incubatorOf(row: MemberRow) {
  return Array.isArray(row.incubators) ? row.incubators[0] ?? null : row.incubators;
}

// The caller's active membership (optionally in one specific incubator).
// Reads through the caller's own RLS-scoped client: incubator_members_read
// lets a user see their own row. Oldest active membership wins when there
// is more than one and no incubatorId is given — the same "oldest wins"
// rule resolveActiveInvestorMember uses.
export async function resolveIncubatorMember(
  sb: SupabaseClient, userId: string, incubatorId?: string | null,
): Promise<IncubatorMember | null> {
  let q = sb.from('incubator_members')
    .select('id, incubator_id, role, created_at, incubators(name, closed_at)')
    .eq('user_id', userId).eq('status', 'active');
  if (incubatorId) q = q.eq('incubator_id', incubatorId);
  const { data, error } = await q.order('created_at', { ascending: true });
  if (error || !data) return null;
  const row = (data as MemberRow[]).find((r) => {
    const inc = incubatorOf(r);
    return !!inc && !inc.closed_at;
  });
  if (!row) return null;
  return { id: row.id, incubatorId: row.incubator_id, role: row.role, incubatorName: incubatorOf(row)!.name };
}

// { member, relationship, level } for a live relationship with orgId, or null
// — null for paused and ended (D6: no grace period), for a non-member, and
// for an org this incubator has no relationship with.
export async function resolveIncubatorAccess(
  sb: SupabaseClient, userId: string, orgId: string, incubatorId?: string | null,
): Promise<IncubatorAccess | null> {
  const member = await resolveIncubatorMember(sb, userId, incubatorId);
  if (!member) return null;
  const { data, error } = await sb.from('incubator_relationships')
    .select('id, org_id, status, sharing_level')
    .eq('incubator_id', member.incubatorId).eq('org_id', orgId).neq('status', 'ended')
    .maybeSingle();
  if (error || !data) return null;
  const status = data.status as RelationshipStatus;
  if (!hasLiveAccess(status)) return null;
  return {
    member,
    relationship: { id: data.id, orgId: data.org_id, status, sharingLevel: data.sharing_level },
    level: data.sharing_level,
  };
}
