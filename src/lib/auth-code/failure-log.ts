// Prompt 911 (B.2) — the failure registry for authentication emails: every time a sign-up or recovery email could not be
// sent, one row (email, action, error, time) in public.auth_email_failures, read in Backoffice -> Email delivery.
// Server-only: it holds the service-role client. It must NEVER throw into a request — a failure to record a failure may
// not turn a sign-up that was already refused into a crash.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clipForLog } from '@/lib/auth-errors';

export type AuthFailureAction = 'signup' | 'resend_code' | 'recover' | 'invite_signup' | 'signup_already_registered';
export const AUTH_FAILURE_ACTIONS: readonly AuthFailureAction[] = ['signup', 'resend_code', 'recover', 'invite_signup', 'signup_already_registered'];

/** Personal data (an email address): kept this long, and no longer. */
export const AUTH_FAILURE_RETENTION_DAYS = 90;

export interface AuthFailureInput {
  email: string;
  action: AuthFailureAction;
  source: 'server' | 'browser';
  /** A thrown AuthError, a JSON body, a string — whatever the failing call produced. Reduced to status/code/message here. */
  error?: unknown;
  status?: number | null;
  code?: string | null;
  message?: string | null;
}

/** Reduce any error shape to the three things worth keeping. Pure. */
export function failureFields(input: Pick<AuthFailureInput, 'error' | 'status' | 'code' | 'message'>): { http_status: number | null; error_code: string | null; error_message: string | null } {
  const e = (input.error && typeof input.error === 'object' ? input.error : {}) as Record<string, unknown>;
  const statusRaw = input.status ?? (typeof e.status === 'number' ? e.status : null);
  const code = input.code ?? (typeof e.code === 'string' ? e.code : typeof e.error_code === 'string' ? e.error_code : null);
  const message = input.message ?? (typeof input.error === 'string' ? input.error : typeof e.message === 'string' ? e.message : null);
  return {
    http_status: typeof statusRaw === 'number' && Number.isFinite(statusRaw) ? Math.trunc(statusRaw) : null,
    error_code: clipForLog(code, 80),
    error_message: clipForLog(message, 400),
  };
}

export async function recordAuthEmailFailure(admin: SupabaseClient, input: AuthFailureInput): Promise<void> {
  try {
    const email = input.email.trim().toLowerCase().slice(0, 254);
    if (!email) return;
    const { error } = await admin.from('auth_email_failures').insert({ email, action: input.action, source: input.source, ...failureFields(input) });
    if (error) { console.error('[auth-failure] insert failed:', error.message); return; }
    // Retention: the writer clears what is older than the window, so no job is needed.
    const cutoff = new Date(Date.now() - AUTH_FAILURE_RETENTION_DAYS * 86_400_000).toISOString();
    await admin.from('auth_email_failures').delete().lt('created_at', cutoff);
  } catch (err) {
    console.error('[auth-failure] could not record:', err instanceof Error ? err.message : err);
  }
}
