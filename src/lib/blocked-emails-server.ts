// Prompt 244/245 — server-only glue for the blocked_emails table (migration
// 0180). One shared check, reused at every account-creation/invite/grant
// server route rather than reimplemented per call site (the same "write it
// once" convention as moderation-actions.ts). Does NOT cover client-side
// signUp()/signInWithOtp() calls, which hit Supabase Auth directly before
// any of our routes run — see the migration's own header comment.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmail } from './blocked-emails';

export async function isEmailBlocked(admin: SupabaseClient, email: string): Promise<boolean> {
  const { data } = await admin.from('blocked_emails').select('id').eq('email', normalizeEmail(email)).maybeSingle();
  return !!data;
}

// Shared error shape for every call site's early-return — consistent
// wording, doesn't hint at WHY (e.g. never says "suspicious activity") so a
// blocked address can't fish for confirmation.
export const BLOCKED_EMAIL_ERROR = 'This email address is not able to access the platform. Contact support if you believe this is a mistake.';

export async function blockEmail(
  admin: SupabaseClient, opts: { email: string; reason: string; actorId: string },
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin.from('blocked_emails').upsert(
    { email: normalizeEmail(opts.email), reason: opts.reason, blocked_by: opts.actorId },
    { onConflict: 'email' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
