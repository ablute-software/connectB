import 'server-only';
// Prompt 927 (A) — the startups that applied to a call of an investor firm reach the Pipeline (deal flow) of the people of that firm who may see them, with a short tag naming the call. Worked out WHEN THE
// PIPELINE IS READ, so a change of team, assignment or blind setting takes effect at once and nothing here goes stale:
//   - the administrators of the call (whoever has "Configure call" in it) see every application SUBMITTED after the notice existed;
//   - an evaluator sees only the applications ASSIGNED to them, and never in a call with blind evaluation (the tag would reveal who applied);
//   - an application counts only if it is submitted (never a draft) and the applicant was SHOWN the notice as they submitted (`pipeline_notice_at`); the older ones are brought in by an administrator for
//     themselves, with "Add applicants to my pipeline" (`call_pipeline_backfills`);
//   - only the people of the organisation that runs the call: the tag lives in that person's own Pipeline response, so an investor of another organisation never gets it, nor learns that the startup applied.
// An incubator's call has no investor pipeline to add to, so only calls of an investor firm (catalog entity) count.
import type { SupabaseClient } from '@supabase/supabase-js';
import { callPermissions } from './access';
import { loadCategories, loadTeamsOfCalls } from './team-store';
import type { Promoter } from './access';

type Row = Record<string, unknown>;

export interface CallPipelineTag {
  callId: string; callName: string; applicationId: string;
  /** Why this person sees it: administers the call, or evaluates this application. */
  role: 'admin' | 'evaluator';
  /** The state of the application (Fit / Not a fit / To validate / Submitted) — only for someone who may see the applications of the call (View applications). */
  state: string | null;
  /** May this person open the application in the call? (administrators with "View applications", and the evaluator of that application.) */
  canOpen: boolean;
}
export interface CallPipelineSource {
  /** startup org id -> its tags (one per call; the same startup in two calls has two). */
  byOrg: Map<string, CallPipelineTag[]>;
  /** The calls of the organisation this person has access to (to choose in "From calls"), newest first. */
  calls: { id: string; name: string }[];
}

const STATE_LABEL: Record<string, string> = { fit: 'Fit', not_fit: 'Not a fit', to_validate: 'To validate' };
export const NO_CALL_PIPELINE: CallPipelineSource = { byOrg: new Map(), calls: [] };

export async function loadCallPipelineSource(admin: SupabaseClient, userId: string, investorCatalogEntityId: string | null): Promise<CallPipelineSource> {
  if (!investorCatalogEntityId) return NO_CALL_PIPELINE;
  const { data: callRows } = await admin.from('calls').select('id, name, deleted_at, created_at').eq('catalog_entity_id', investorCatalogEntityId);
  const calls = ((callRows ?? []) as Row[]).filter((c) => !c.deleted_at).sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  if (calls.length === 0) return NO_CALL_PIPELINE;
  const ids = calls.map((c) => c.id as string);

  const { data: member } = await admin.from('matchdeal_investor_members').select('role').eq('user_id', userId).eq('catalog_entity_id', investorCatalogEntityId).eq('status', 'active').maybeSingle();
  const role = ((member as { role?: string } | null)?.role as string | undefined) ?? 'member';
  const promoter: Pick<Promoter, 'kind' | 'role'> = { kind: 'catalog_entity', role };
  const [categories, teams, assignedRes, settingsRes, backfillRes, appsRes] = await Promise.all([
    loadCategories(admin, { kind: 'catalog_entity', id: investorCatalogEntityId }),
    loadTeamsOfCalls(admin, ids),
    admin.from('call_eval_assignments').select('call_id, application_id').eq('evaluator_user_id', userId).eq('status', 'assigned').in('call_id', ids),
    admin.from('call_eval_settings').select('call_id, blind').in('call_id', ids),
    admin.from('call_pipeline_backfills').select('call_id').eq('user_id', userId).in('call_id', ids),
    admin.from('call_applications').select('id, call_id, startup_org_id, status, pipeline_notice_at').in('call_id', ids).eq('status', 'submitted'),
  ]);
  const perms = new Map(ids.map((id) => [id, callPermissions(promoter, userId, { categories, members: teams.get(id) ?? [] })]));
  const blind = new Set(((settingsRes.data ?? []) as Row[]).filter((s) => s.blind === true).map((s) => s.call_id as string));
  const backfilled = new Set(((backfillRes.data ?? []) as Row[]).map((r) => r.call_id as string));
  const assignedApps = new Set(((assignedRes.data ?? []) as Row[]).map((r) => r.application_id as string));
  const accessible = new Set<string>();
  for (const id of ids) if (perms.get(id)!.configure_call || perms.get(id)!.view_all_applications) accessible.add(id);
  for (const r of (assignedRes.data ?? []) as Row[]) accessible.add(r.call_id as string);

  const apps = ((appsRes.data ?? []) as Row[]).filter((a) => a.startup_org_id);
  const eligibility = new Map<string, string>();
  const needsState = apps.filter((a) => perms.get(a.call_id as string)?.view_all_applications).map((a) => a.id as string);
  if (needsState.length > 0) {
    const { data: el } = await admin.from('call_application_eligibility').select('application_id, status, is_current').in('application_id', needsState);
    for (const r of (el ?? []) as Row[]) if (r.is_current !== false) eligibility.set(r.application_id as string, r.status as string);
  }

  const nameOf = new Map(calls.map((c) => [c.id as string, (c.name as string) || 'Untitled call']));
  const byOrg = new Map<string, CallPipelineTag[]>();
  for (const a of apps) {
    const callId = a.call_id as string; const appId = a.id as string; const p = perms.get(callId)!;
    const noticed = !!a.pipeline_notice_at || backfilled.has(callId);
    let tag: CallPipelineTag | null = null;
    if (p.configure_call && noticed) {
      tag = { callId, callName: nameOf.get(callId)!, applicationId: appId, role: 'admin', state: p.view_all_applications ? (STATE_LABEL[eligibility.get(appId) ?? ''] ?? 'Submitted') : null, canOpen: p.view_all_applications };
    } else if (assignedApps.has(appId) && !blind.has(callId) && a.pipeline_notice_at) {
      tag = { callId, callName: nameOf.get(callId)!, applicationId: appId, role: 'evaluator', state: null, canOpen: true };
    }
    if (!tag) continue;
    const orgId = a.startup_org_id as string;
    const list = byOrg.get(orgId) ?? [];
    if (!list.some((t) => t.callId === callId)) list.push(tag);           // one tag per call, even if the startup applied twice
    byOrg.set(orgId, list);
  }
  return { byOrg, calls: calls.filter((c) => accessible.has(c.id as string)).map((c) => ({ id: c.id as string, name: nameOf.get(c.id as string)! })) };
}
