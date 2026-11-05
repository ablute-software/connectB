import 'server-only';
// Prompt 929 (A) — the maximum number of applications of a call, changed after it is open. Its own module: it needs the notices, and the notices need the store.
import type { SupabaseClient } from '@supabase/supabase-js';
import { rowToCall } from './mappers';
import { countApplications, logCallEvent } from './store';
import { notifyCallFull, notifyCallReopened } from './applicant/notices';
import type { Call } from './types';

type Row = Record<string, unknown>;

/**
 * The maximum number of applications and "show how many places are left" may change AT ANY TIME, also once the call is open (Prompt 929, A): nothing an applicant answers depends on them. Raising or removing the limit
 * on a FULL call that is still within its dates takes it out of "Full" again and tells whoever has a draft; lowering it to what was already submitted makes it full (and tells them too). Returns the call as it is now.
 */
export async function setCallLimit(admin: SupabaseClient, call: Call, patch: { max_applications?: number | null; show_places_left?: boolean }, entityName: string): Promise<Call | null> {
  const next: Row = { updated_at: new Date().toISOString() };
  if ('max_applications' in patch) next.max_applications = patch.max_applications ?? null;
  if ('show_places_left' in patch) next.show_places_left = patch.show_places_left === true;
  const newMax = 'max_applications' in patch ? (patch.max_applications ?? null) : (call.maxApplications ?? null);
  const submitted = newMax === null ? 0 : (await countApplications(admin, call.id)).submitted;
  const nowFull = newMax !== null && submitted >= newMax;
  const wasFull = !!call.fullAt;
  if (wasFull && !nowFull) next.full_at = null;
  if (!wasFull && nowFull) next.full_at = new Date().toISOString();
  const { data } = await admin.from('calls').update(next).eq('id', call.id).select('*');
  const row = (data ?? [])[0] as Row | undefined;
  if (!row) return null;
  const updated = rowToCall(row);
  await logCallEvent(admin, call.id, 'call_limit_changed', null, { before: call.maxApplications, after: newMax, submitted, full: nowFull });
  const open = updated.status === 'open' && !!updated.opensAt && Date.parse(updated.opensAt) <= Date.now() && (!updated.closesAt || Date.parse(updated.closesAt) > Date.now());
  if (open && wasFull && !nowFull) await notifyCallReopened(admin, updated, entityName, call.fullAt as string).catch((e) => console.error('[calls] reopened notices failed:', (e as Error).message));
  if (open && !wasFull && nowFull) await notifyCallFull(admin, updated, entityName, updated.fullAt ?? 'full').catch((e) => console.error('[calls] full notices failed:', (e as Error).message));
  return updated;
}
