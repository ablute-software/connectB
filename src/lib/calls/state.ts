// Prompt 905 — the full picture of one call as the editor needs it, built in one place so every route that
// changes something returns the same shape the editor reads (and the editor never has to guess what changed).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { availableActions, effectiveStatus, readiness, summarise } from './lifecycle';
import { countApplications, loadEvents, loadFields, loadPhases, logCallEvent, promoterName, transitionCall } from './store';
import type { Promoter } from './access';
import type { Call } from './types';

/**
 * A scheduled call whose time has come is Open, and an open one past its deadline is Closed. Hobby-plan crons run
 * once a day, so the status is brought up to date whenever somebody looks (and the applicant side does the same);
 * `effectiveStatus` is what the UI shows either way. System actions have no actor.
 */
export async function syncStatus(admin: SupabaseClient, call: Call, now: Date = new Date()): Promise<Call> {
  const eff = effectiveStatus(call, now);
  if (eff === call.status) return call;
  if (call.status === 'scheduled' && eff === 'closed') {
    // Skipped Open entirely (nobody looked in between): record both steps.
    const opened = await transitionCall(admin, call, { status: 'open' });
    if (!opened) return call;
    await logCallEvent(admin, call.id, 'call_opened', null, { automatic: true });
    const closed = await transitionCall(admin, opened, { status: 'closed', closed_at: now.toISOString() });
    if (closed) await logCallEvent(admin, call.id, 'call_closed', null, { automatic: true });
    return closed ?? opened;
  }
  const next = await transitionCall(admin, call, eff === 'closed' ? { status: 'closed', closed_at: now.toISOString() } : { status: eff });
  if (!next) return call;
  await logCallEvent(admin, call.id, eff === 'open' ? 'call_opened' : 'call_closed', null, { automatic: true });
  return next;
}

export async function buildCallState(admin: SupabaseClient, call: Call, promoter: Promoter, now: Date = new Date()) {
  const synced = await syncStatus(admin, call, now);
  const [phases, fields, events, name, applications, team] = await Promise.all([
    loadPhases(admin, synced.id), loadFields(admin, synced.id), loadEvents(admin, synced.id, 30), promoterName(admin, synced.promoterKind, synced.promoterId),
    countApplications(admin, synced.id),
    admin.from('call_team_members').select('user_id').eq('call_id', synced.id),
  ]);
  const issues = readiness(synced, phases, fields, now);
  return {
    ok: true as const,
    call: synced,
    effectiveStatus: effectiveStatus(synced, now),
    promoterName: name,
    canManage: promoter.canManage,
    canManageTeam: promoter.canManageTeam === true,
    phases, fields, issues,
    // How many people were put on the team (the Setup step "Team & distribution" shows ✓ once there is at least one).
    teamMembers: ((team.data ?? []) as unknown[]).length,
    summary: summarise(phases, fields),
    // Prompt 907: the entity sees what was SUBMITTED and a total (the delete rule needs "has anyone applied?"), never how many are still being
    // filled in: a draft is the applicant's own until they submit it.
    applications: { submitted: applications.submitted, total: applications.total },
    actions: availableActions(synced, issues, now, applications.total),
    events,
  };
}
