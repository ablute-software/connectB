// Prompt 904 Part B — the real ports behind src/lib/auth-code/service.ts: Supabase Auth for
// the code itself, Postgres functions (migration 20261009120000) for the counters, Resend for
// the "you already have an account" email. Server-only: it holds the service-role key.
import 'server-only';
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { APP_URL, BRAND_NAME } from '@/lib/brand';
import {
  IP_REQUEST_LIMIT, IP_VERIFY_LIMIT, IP_WINDOW_SECONDS, MAX_SENDS_PER_WINDOW, MAX_WRONG_ATTEMPTS,
  RESEND_MIN_INTERVAL_SECONDS, SEND_WINDOW_SECONDS,
} from './policy';
import type { AuthCodePorts } from './service';
import { recordAuthEmailFailure } from './failure-log';

export function adminClientOrNull(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  return createClient(url, service, { auth: { persistSession: false } });
}

function anonClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Unguessable and policy-compliant: the account is born with this, never with what the person typed. */
export function throwawayPassword(): string {
  return `${randomBytes(24).toString('base64url')}aA1!`;
}

export function makeSupabasePorts(admin: SupabaseClient): AuthCodePorts {
  // The cookie-writing client that verifyOtp signed the person in with. The typed password is applied THROUGH THIS SAME CLIENT
  // (finalizeAccount), so the session that was just created is the one that applies it.
  let sessionClient: Awaited<ReturnType<typeof serverClient>> | null = null;
  return {
    async ipLimited(ip, kind) {
      const { data, error } = await admin.rpc('auth_code_ip_hit', {
        p_ip: ip, p_kind: kind,
        p_limit: kind === 'request' ? IP_REQUEST_LIMIT : IP_VERIFY_LIMIT,
        p_window_seconds: IP_WINDOW_SECONDS,
      });
      // Fail-open, as the guest-link limiter does: the per-email counters below are the
      // protection that matters, and a blip must not lock every candidate out.
      return error ? false : data === true;
    },

    async reserveSend(email) {
      const { data, error } = await admin.rpc('auth_code_reserve_send', {
        p_email: email, p_min_interval: RESEND_MIN_INTERVAL_SECONDS,
        p_max_per_window: MAX_SENDS_PER_WINDOW, p_window_seconds: SEND_WINDOW_SECONDS,
      });
      if (error || !data) throw new Error(`auth_code_reserve_send: ${error?.message ?? 'no data'}`);
      return { allowed: data.allowed === true, reason: data.reason, retryAfterSeconds: Number(data.retry_after ?? 0) };
    },

    async reserveAttempt(email) {
      const { data, error } = await admin.rpc('auth_code_reserve_attempt', { p_email: email, p_max: MAX_WRONG_ATTEMPTS });
      if (error || !data) throw new Error(`auth_code_reserve_attempt: ${error?.message ?? 'no data'}`);
      return { allowed: data.allowed === true, reason: data.reason, attemptsLeft: Number(data.attempts_left ?? 0) };
    },

    async markUsed(email) {
      await admin.rpc('auth_code_mark_used', { p_email: email });
    },

    async userState(email) {
      const { data, error } = await admin.rpc('auth_code_user_state', { p_email: email });
      if (error || !data) throw new Error(`auth_code_user_state: ${error?.message ?? 'no data'}`);
      return { exists: data.exists === true, confirmed: data.confirmed === true };
    },

    async createAccountAndSendCode(email, profile, ctx) {
      const { error } = await anonClient().auth.signUp({
        email,
        password: throwawayPassword(),
        options: {
          // Where the link in the email brings the person back to ("{{ .RedirectTo }}" in the Confirm signup template).
          emailRedirectTo: ctx.redirectTo,
          data: {
            full_name: profile.fullName, org_name: profile.startup, country: profile.country, title: profile.role,
            // An incubator team member's account is born with this, so the invite flow recognises it (Prompt I-01c).
            ...(ctx.intent ? { signup_intent: ctx.intent } : {}),
            // Not yet: the typed password is applied after the code is verified. Until then
            // the first-login /set-password screen is the right place for this account.
            password_set: false,
          },
        },
      });
      if (error) throw error;
    },

    async resendCode(email, ctx) {
      const { error } = await anonClient().auth.resend({ type: 'signup', email, options: { emailRedirectTo: ctx.redirectTo } });
      if (error) throw error;
    },

    async sendAlreadyRegisteredEmail(email) {
      const result = await sendTransactionalEmail({
        to: email,
        subject: `You already have a ${BRAND_NAME} account`,
        html: transactionalTemplate({
          heading: 'You already have an account',
          body: `Someone (hopefully you) tried to register on ${BRAND_NAME} with this email address, which already has an account. No new account was created. Sign in below; if you forgot your password, use "Forgot password" on the sign-in page.`,
          ctaLabel: 'Sign in',
          ctaUrl: `${APP_URL}/login`,
          footer: 'If this was not you, you can ignore this email. Nothing has changed on your account.',
        }),
        context: { kind: 'other' },
      });
      if (!result.sent) throw new Error(`already-registered email not sent: ${result.error ?? 'unknown'}`);
    },

    async verifyCode(email, code) {
      // The cookie-writing client, on purpose: a successful verifyOtp is what signs the person in.
      const sb = await serverClient();
      const { data, error } = await sb.auth.verifyOtp({ email, token: code, type: 'signup' });
      if (error || !data.user || !data.session) return { ok: false };
      sessionClient = sb;
      return { ok: true, userId: data.user.id };
    },

    async finalizeAccount(_userId, password, profile) {
      // Prompt 911 (fix, 13/10/2026): the typed password is applied with the SESSION'S OWN client (auth.updateUser), never with
      // the admin API. Found in production (sherlockdeal.com+codigo2, 14:30): admin.updateUserById({ password }) ENDS every session
      // of the user, so right after the right code the person had no session (GET /user -> 403 "Session not found") and landed on the
      // home page, signed out. updateUser on the session that verifyOtp just created keeps that session. The security rule is unchanged:
      // the password is still only applied AFTER the code was verified (this runs only once verifyCode succeeded).
      const sb = sessionClient ?? (await serverClient());
      // Only what the form actually collected: an invite has no profile, and an empty string must not blank what the account already has.
      const metadata: Record<string, unknown> = { password_set: true };
      const fields: Record<string, string> = { full_name: profile.fullName, org_name: profile.startup, country: profile.country, title: profile.role };
      for (const [k, v] of Object.entries(fields)) if (v) metadata[k] = v;
      const { error } = await sb.auth.updateUser({ password, data: metadata });
      return error ? { ok: false, error: error.message } : { ok: true };
    },

    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    logError: (where, err) => console.error(`[auth-code] ${where}:`, err instanceof Error ? err.message : err),
    recordFailure: (f) => recordAuthEmailFailure(admin, { email: f.email, action: f.action, source: 'server', error: f.error }),
  };
}
