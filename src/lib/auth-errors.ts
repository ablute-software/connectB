// Prompt 911 (B.1) — ONE function that turns whatever an authentication call threw or answered into a sentence a person
// can read. Nothing in an authentication screen may ever show an object, JSON, `{}` or "[object Object]": on 12/10/2026
// the Supabase Auth SMTP started refusing every email (500 / unexpected_failure) and /signup showed `{}`.
//
// Pure and client-safe (no I/O), so the sign-up pages, the code step, the password-recovery page and the routes all say
// the same thing, and a test can feed it every shape of error that reaches the screens.

/** The inbox people are told to write to when an email cannot be sent. One place, so it is changed once. */
export const AUTH_SUPPORT_EMAIL = 'support@sherlockdeal.com';

export type AuthErrorKind = 'send_failed' | 'rate_limited' | 'wrong_code' | 'expired_code' | 'network' | 'generic';

export interface AuthErrorInfo {
  kind: AuthErrorKind;
  /** The sentence for the screen. Always a non-empty string. */
  text: string;
  /** The machine code, for the small print under a generic message. Null when there is none. */
  code: string | null;
}

export const SEND_FAILED_TEXT = `We couldn't send the email right now. Please try again in a few minutes. If it keeps failing, write to us at ${AUTH_SUPPORT_EMAIL}.`;
export const RATE_LIMITED_TEXT = 'Too many attempts. Please wait a few minutes.';
export const WRONG_CODE_TEXT = "That code didn't work. Check it and try again, or ask for a new one.";
export const EXPIRED_CODE_TEXT = 'That code has expired or was already used. Please ask for a new one.';
export const NETWORK_TEXT = 'We could not reach the server. Check your connection and try again.';
export const GENERIC_TEXT = 'Something went wrong. Please try again.';

const SEND_FAILED_CODES = new Set(['unexpected_failure', 'send_failed', 'smtp_failed', 'email_send_failed']);
const RATE_LIMIT_CODES = new Set(['over_request_rate_limit', 'over_email_send_rate_limit', 'over_sms_send_rate_limit', 'rate_limited', 'too_early', 'hourly_cap', 'ip_limited', 'too_many_requests']);
const EXPIRED_CODES = new Set(['otp_expired', 'new_code_required', 'flow_state_expired', 'expired_code']);

/** A value that carries no message of its own: an empty object, a bare array, null, a number, "{}" ... */
function textOf(v: unknown): string {
  if (typeof v === 'string') {
    const t = v.trim();
    // Never let a stringified empty object through as if it were a message.
    return t === '{}' || t === '[]' || t === 'null' || t === 'undefined' || t === '[object Object]' ? '' : t;
  }
  return '';
}

function pick(err: unknown): { status: number | null; code: string | null; message: string } {
  if (err == null) return { status: null, code: null, message: '' };
  if (typeof err === 'string') return { status: null, code: null, message: textOf(err) };
  if (typeof err !== 'object') return { status: null, code: null, message: '' };
  const o = err as Record<string, unknown>;
  const status = typeof o.status === 'number' ? o.status : typeof o.statusCode === 'number' ? o.statusCode : null;
  const code = textOf(o.code) || textOf(o.error_code) || null;
  // `error` can itself be a string or a nested { message }, depending on who produced the body.
  const nested = o.error && typeof o.error === 'object' ? textOf((o.error as Record<string, unknown>).message) : '';
  const message = textOf(o.message) || textOf(o.error) || nested || textOf(o.msg) || textOf(o.error_description);
  return { status, code, message };
}

/**
 * Classify an error (a thrown AuthError, a JSON body, a string, anything) and give it its sentence.
 * `serverText`: a sentence a route of ours already wrote for this exact case (it is trusted, and kept when it is
 * specific, e.g. "That code didn't work. 3 attempts left."); the generic fall-backs never replace a specific one.
 */
export function describeAuthError(err: unknown, opts: { serverText?: string } = {}): AuthErrorInfo {
  const { status, code, message } = pick(err);
  const lower = message.toLowerCase();
  const c = (code ?? '').toLowerCase();

  if (c === 'network' || lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('could not reach the server')) {
    return { kind: 'network', text: NETWORK_TEXT, code };
  }
  if (c === 'wrong_code') {
    return { kind: 'wrong_code', text: textOf(opts.serverText) || WRONG_CODE_TEXT, code };
  }
  if (EXPIRED_CODES.has(c) || lower.includes('otp expired') || lower.includes('token has expired')) {
    return { kind: 'expired_code', text: textOf(opts.serverText) || EXPIRED_CODE_TEXT, code };
  }
  if (status === 429 || RATE_LIMIT_CODES.has(c) || lower.includes('rate limit') || lower.includes('too many')) {
    return { kind: 'rate_limited', text: textOf(opts.serverText) || RATE_LIMITED_TEXT, code };
  }
  if (
    SEND_FAILED_CODES.has(c) || status === 500 || status === 502 || status === 503 || status === 504 ||
    lower.includes('error sending') || lower.includes('gomail') || lower.includes('smtp') || lower.includes('could not send') || lower.includes('sending confirmation') || lower.includes('sending recovery')
  ) {
    return { kind: 'send_failed', text: SEND_FAILED_TEXT, code };
  }
  const specific = textOf(opts.serverText);
  if (specific) return { kind: 'generic', text: specific, code };
  // Anything else: one generic sentence, with the code in small print so a support request can quote it. Never the raw body.
  const small = code ? ` (${code})` : status ? ` (${status})` : '';
  return { kind: 'generic', text: `${GENERIC_TEXT}${small}`, code };
}

/** The sentence only. For the places that just need a string. */
export function authErrorText(err: unknown, opts: { serverText?: string } = {}): string {
  return describeAuthError(err, opts).text;
}

/** Truncation for what is written to the failure log: a provider can send a very long body. */
export function clipForLog(v: unknown, max = 400): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
