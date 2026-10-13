// Prompt 911 — the browser side of "register with a 6-digit code", shared by /signup, the team invite and the incubator
// team invite (the 904 test page keeps its own, older wiring). One place that talks to /api/auth-code/*, so no page can
// ever put a raw body on screen: every outcome is either a typed success or a sentence (describeAuthError).
//
// Why a 404 is an outcome and not an error: AUTH_CODE_MODE=off (the emergency brake) makes the routes answer 404. The pages
// then fall back to the link-only flow they had before, so that a switched-off code flow never leaves anybody stuck.
import { describeAuthError, NETWORK_TEXT } from '@/lib/auth-errors';
import type { RegistrationIntent, RegistrationProfile } from './policy';

async function postJson(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> } | null> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json: json && typeof json === 'object' ? json : {} };
  } catch {
    return null;
  }
}

const EMPTY_PROFILE: RegistrationProfile = { fullName: '', startup: '', country: '', role: '' };
const asText = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const asNumber = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export type RegisterOutcome =
  | { kind: 'sent'; message: string; resendAfterSeconds: number }
  | { kind: 'off' }
  | { kind: 'error'; text: string; retryAfterSeconds?: number };

export async function registerWithCode(input: {
  email: string; password: string; profile?: Partial<RegistrationProfile>; intent?: RegistrationIntent;
  /** Where the link in the email brings the person back to: a path of this site (omitted = the platform). */
  redirectPath?: string;
}): Promise<RegisterOutcome> {
  const r = await postJson('/api/auth-code/register', { email: input.email, password: input.password, ...EMPTY_PROFILE, ...input.profile, intent: input.intent, redirectPath: input.redirectPath });
  if (!r) return { kind: 'error', text: NETWORK_TEXT };
  if (r.status === 404) return { kind: 'off' };
  if (r.status === 200 && r.json.ok === true) {
    return { kind: 'sent', message: asText(r.json.message) ?? `We sent a code to ${input.email}.`, resendAfterSeconds: asNumber(r.json.resendAfterSeconds) ?? 60 };
  }
  const info = describeAuthError({ status: r.status, code: asText(r.json.code), message: asText(r.json.error) }, { serverText: asText(r.json.error) });
  return { kind: 'error', text: info.text, retryAfterSeconds: asNumber(r.json.retryAfterSeconds) };
}

export type ResendOutcome =
  | { kind: 'sent'; resendAfterSeconds: number }
  | { kind: 'error'; text: string; retryAfterSeconds?: number };

export async function resendRegistrationCode(email: string, redirectPath?: string): Promise<ResendOutcome> {
  const r = await postJson('/api/auth-code/resend', { email, redirectPath });
  if (!r) return { kind: 'error', text: NETWORK_TEXT };
  if (r.status === 200 && r.json.ok === true) return { kind: 'sent', resendAfterSeconds: asNumber(r.json.resendAfterSeconds) ?? 60 };
  const info = describeAuthError({ status: r.status, code: asText(r.json.code), message: asText(r.json.error) }, { serverText: asText(r.json.error) });
  return { kind: 'error', text: info.text, retryAfterSeconds: asNumber(r.json.retryAfterSeconds) };
}

export type VerifyOutcome =
  | { kind: 'ok'; userId: string | null; passwordSet: boolean; warning?: string }
  | { kind: 'error'; text: string; code: string | null; needsNewCode: boolean; wrongCode: boolean };

export async function verifyRegistrationCodeRequest(input: {
  email: string; code: string; password: string; profile?: Partial<RegistrationProfile>;
}): Promise<VerifyOutcome> {
  const r = await postJson('/api/auth-code/verify', { email: input.email, code: input.code, password: input.password, ...EMPTY_PROFILE, ...input.profile });
  if (!r) return { kind: 'error', text: NETWORK_TEXT, code: 'network', needsNewCode: false, wrongCode: false };
  if (r.status === 200 && r.json.ok === true) {
    return { kind: 'ok', userId: asText(r.json.userId) ?? null, passwordSet: r.json.passwordSet !== false, warning: asText(r.json.warning) };
  }
  const code = asText(r.json.code) ?? null;
  const info = describeAuthError({ status: r.status, code, message: asText(r.json.error) }, { serverText: asText(r.json.error) });
  return { kind: 'error', text: info.text, code, needsNewCode: code === 'new_code_required', wrongCode: code === 'wrong_code' };
}

/** Tell the registry that the browser was refused an email by Supabase directly (the link-only fallback, password recovery). */
export async function reportAuthEmailFailure(input: { email: string; action: 'signup' | 'recover' | 'invite_signup' | 'login'; error: unknown }): Promise<void> {
  try {
    const e = (input.error && typeof input.error === 'object' ? input.error : {}) as Record<string, unknown>;
    await fetch('/api/auth-failures/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({
        email: input.email, action: input.action,
        status: typeof e.status === 'number' ? e.status : null,
        code: typeof e.code === 'string' ? e.code : typeof e.error_code === 'string' ? e.error_code : null,
        message: typeof e.message === 'string' ? e.message : typeof input.error === 'string' ? input.error : null,
      }),
    });
  } catch { /* reporting must never get in the way of the message the person is about to read */ }
}
