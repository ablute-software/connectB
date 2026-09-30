// Prompt I-01c §A.3 — "is there an ecosystem-organisation team invite waiting
// for this person?" Read with the service role (an invited row is not the
// caller's yet, so RLS does not show it to them) and reduced to a boolean: no
// organisation name, id or row ever leaves the server through this.
import 'server-only';
import { createClient } from '@supabase/supabase-js';

export interface PendingInviteUser { email?: string | null; email_confirmed_at?: string | null }

export async function hasPendingIncubatorMemberInvite(user: PendingInviteUser): Promise<boolean> {
  // Only a CONFIRMED address counts — the same rule as
  // incubator_accept_pending_member_invites(), which is what the landing
  // page then calls.
  if (!user.email || !user.email_confirmed_at) return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return false;
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data, error } = await admin.from('incubator_members')
    .select('id, invite_expires_at, incubators!inner(closed_at)')
    .eq('status', 'invited')
    .eq('invited_email', user.email.trim().toLowerCase())
    .is('incubators.closed_at', null)
    .limit(5);
  // Before the foundation migration existed this table did not; any error
  // reads as "no invite", never as a reason to block the ordinary flow.
  if (error || !data) return false;
  const now = Date.now();
  return data.some((r) => !r.invite_expires_at || new Date(r.invite_expires_at as string).getTime() > now);
}
