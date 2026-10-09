// Prompt 905 — the full picture of one call as the editor needs it, built in one place so every route that
// changes something returns the same shape the editor reads (and the editor never has to guess what changed).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { availableActions, effectiveStatus, readiness, summarise } from './lifecycle';
import { loadEvents, loadFields, loadPhases, logCallEvent, promoterName, transitionCall } from './store';
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
  const [phases, fields, events, name] = await Promise.all([
    loadPhases(admin, synced.id), loadFields(admin, synced.id), loadEvents(admin, synced.id, 30), promoterName(admin, synced.promoterKind, synced.promoterId),
  ]);
  const issues = readiness(synced, phases, fields, now);
  return {
    ok: true as const,
    call: synced,
    effectiveStatus: effectiveStatus(synced, now),
    promoterName: name,
    canManage: promoter.canManage,
    phases, fields, issues,
    summary: summarise(phases, fields),
    actions: availableActions(synced, issues, now),
    events,
  };
}
