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

    async createAccountAndSendCode(email, profile) {
      const { error } = await anonClient().auth.signUp({
        email,
        password: throwawayPassword(),
        options: {
          data: {
            full_name: profile.fullName, org_name: profile.startup, country: profile.country, title: profile.role,
            // Not yet: the typed password is applied after the code is verified. Until then
            // the first-login /set-password screen is the right place for this account.
            password_set: false,
          },
        },
      });
      if (error) throw error;
    },

    async resendCode(email) {
      const { error } = await anonClient().auth.resend({ type: 'signup', email });
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
      return { ok: true, userId: data.user.id };
    },

    async finalizeAccount(userId, password, profile) {
      const { data: existing } = await admin.auth.admin.getUserById(userId);
      const { error } = await admin.auth.admin.updateUserById(userId, {
        password,
        user_metadata: {
          ...(existing?.user?.user_metadata ?? {}),
          full_name: profile.fullName, org_name: profile.startup, country: profile.country, title: profile.role,
          password_set: true,
        },
      });
      return error ? { ok: false, error: error.message } : { ok: true };
    },

    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    logError: (where, err) => console.error(`[auth-code] ${where}:`, err instanceof Error ? err.message : err),
  };
}
