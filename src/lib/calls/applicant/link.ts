// Prompt 907 — resolve the call behind a link token, for every applicant-side route. One place, so the public header, the session
// probe, the start of an application and the submission all agree on what "this link works" means:
//   - Calls are not switched off (CALLS_MODE=off answers 404 as if the routes did not exist);
//   - the token belongs to a published call: a call taken back to draft ("Edit configuration") keeps its link but is not advertised,
//     an archived call is not either (Prompt 909);
//   - the call has a form (a call without one is a 404: there is nothing to apply to).
// The status is brought up to date (scheduled -> open -> closed) the same way the entity side does, because crons run once a day.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callsAdminClient } from '../admin-client';
import { callsMode } from '../mode';
import { loadCallByToken, loadFields } from '../store';
import { syncStatus } from '../state';
import type { Call, FormField } from '../types';

export function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  return callsAdminClient(url, service);
}

export const validTokenShape = (token: string): boolean => token.length >= 16 && token.length <= 64 && /^[A-Za-z0-9_-]+$/.test(token);

export async function resolvePublicCall(admin: SupabaseClient, token: string, now: Date = new Date()): Promise<{ call: Call; fields: FormField[] } | null> {
  if (callsMode() === 'off' || !validTokenShape(token)) return null;
  const found = await loadCallByToken(admin, token);
  if (!found || found.status === 'draft' || found.status === 'archived') return null;
  const call = await syncStatus(admin, found, now);
  const fields = await loadFields(admin, call.id);
  if (fields.length === 0) return null;
  return { call, fields };
}
