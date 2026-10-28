// Prompt 911 (B.1) — ONE function that turns whatever an authentication call threw or answered into a sentence a person
// can read. Nothing in an authentication screen may ever show an object, JSON, `{}` or "[object Object]": on 12/10/2026
// the Supabase Auth SMTP started refusing every email (500 / unexpected_failure) and /signup showed `{}`.
//
// Pure and client-safe (no I/O), so the sign-up pages, the code step, the password-recovery page and the routes all say
// the same thing, and a test can feed it every shape of error that reaches the screens.

/**
 * Where people are sent when an email cannot be sent: the CONTACT FORM, never an address. There is no public support address until
 * support@sherlockdeal.com is forwarded (docs/ops/CONFIG_REGISTRY.md, "Contacto de suporte"), and the owner's own inbox must never
 * be shown to users. The phrase is rendered as a link by AuthMessage.
 */
export const CONTACT_PATH = '/contact';
export const CONTACT_PHRASE = 'contact us';

export type AuthErrorKind = 'send_failed' | 'rate_limited' | 'wrong_code' | 'expired_code' | 'invalid_email' | 'network' | 'generic';

export interface AuthErrorInfo {
  kind: AuthErrorKind;
  /** The sentence for the screen. Always a non-empty string. */
  text: string;
  /** The machine code, for the small print under a generic message. Null when there is none. */
  code: string | null;
  /** Prompt 923 (C): how long the person must wait before asking for another code, when the provider said so. */
  retryAfterSeconds: number | null;
  /** The reference shown with a generic message and written to the server's failure log, so a support request can quote it. */
  ref: string | null;
}

export const SEND_FAILED_TEXT = `We couldn't send the email right now. Please try again in a few minutes. If it keeps failing, ${CONTACT_PHRASE}.`;
export const RATE_LIMITED_TEXT = 'Too many attempts. Please wait a few minutes.';
export const WRONG_CODE_TEXT = "That code didn't work. Check it and try again, or ask for a new one.";
export const EXPIRED_CODE_TEXT = 'This code has expired or was replaced by a newer one. Use the latest code we sent, or request a new one.';
/** Prompt 923 (C): said after a code is sent, because asking for another one cancels the first. */
export const NEW_CODE_NOTE = 'Asking for a new code replaces the previous one: always use the latest code we sent.';
export const EMAIL_INCOMPLETE_TEXT = 'Check the email address — it looks incomplete.';
/** Prompt 923 (C): the wait before another code, in the person's own words. */
export const rateLimitedText = (seconds: number): string => `For security, wait ${seconds} second${seconds === 1 ? '' : 's'} before asking for a new code.`;
export const NETWORK_TEXT = 'We could not reach the server. Check your connection and try again.';
export const GENERIC_TEXT = 'Something went wrong. Try again in a minute.';
/** "Set a new password" reached with no session: the link expired, or was opened in another browser than the one that asked for it (Prompt 918, 27/10/2026). */
export const LINK_EXPIRED_TEXT = 'This link has expired or was opened in a different browser. Request a new link.';

/**
 * Prompt 923 (C): an email that can never be an address is refused BEFORE a code is asked for. On 28/10/2026 "…@gmail.c" reached Supabase and came back as a 500 ("Invalid recipient address") that
 * nobody could understand. The same loose shape the server checks (auth-code/policy.ts): the real proof is that the code arrives; this only catches a typo. null = looks fine.
 */
const EMAIL_LOOSE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function emailProblem(raw: unknown): string | null {
  const email = typeof raw === 'string' ? raw.trim() : '';
  return email.length > 0 && email.length <= 254 && EMAIL_LOOSE.test(email) ? null : EMAIL_INCOMPLETE_TEXT;
}

/** A short reference for a failure the person cannot fix: shown on the screen and written to the server's failure log. No ambiguous characters (0/O, 1/I). */
export function newReference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes); else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** How many seconds the provider (or our own route) said to wait: "…you can only request this after 219 seconds", `retryAfterSeconds`, `retry_after`. null when it said nothing. */
export function retryAfterSeconds(err: unknown): number | null {
  if (!err || typeof err !== 'object') return typeof err === 'string' ? waitFromText(err) : null;
  const o = err as Record<string, unknown>;
  for (const k of ['retryAfterSeconds', 'retry_after', 'retryAfter']) { const v = o[k]; if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.ceil(v); }
  return waitFromText(String(o.message ?? o.error ?? o.msg ?? ''));
}
function waitFromText(t: string): number | null {
  const m = /(?:after|in|within)\s+(\d{1,5})\s*(?:seconds?|secs?|s)\b/i.exec(t);
  return m ? Math.max(1, Number(m[1])) : null;
}

/** Supabase's own "there is no session" error (`AuthSessionMissingError`, "Auth session missing!"), however it reached us. */
export function isSessionMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return typeof err === 'string' && /auth session missing/i.test(err);
  const o = err as Record<string, unknown>;
  return o.name === 'AuthSessionMissingError' || /auth session missing/i.test(String(o.message ?? ''));
}

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
export function describeAuthError(err: unknown, opts: { serverText?: string; ref?: string } = {}): AuthErrorInfo {
  const { status, code, message } = pick(err);
  const lower = message.toLowerCase();
  const c = (code ?? '').toLowerCase();
  const wait = retryAfterSeconds(err);
  const base = { retryAfterSeconds: wait, ref: null as string | null };

  if (c === 'network' || lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('could not reach the server')) {
    return { kind: 'network', text: NETWORK_TEXT, code, ...base };
  }
  if (c === 'wrong_code') {
    return { kind: 'wrong_code', text: textOf(opts.serverText) || WRONG_CODE_TEXT, code, ...base };
  }
  if (EXPIRED_CODES.has(c) || lower.includes('otp expired') || lower.includes('token has expired')) {
    return { kind: 'expired_code', text: c === 'new_code_required' ? textOf(opts.serverText) || EXPIRED_CODE_TEXT : EXPIRED_CODE_TEXT, code, ...base };
  }
  if (status === 429 || RATE_LIMIT_CODES.has(c) || lower.includes('rate limit') || lower.includes('too many')) {
    return { kind: 'rate_limited', text: wait ? rateLimitedText(wait) : textOf(opts.serverText) || RATE_LIMITED_TEXT, code, ...base };
  }
  if (c === 'email_address_invalid' || c === 'validation_failed' || lower.includes('invalid recipient') || (lower.includes('email address') && lower.includes('invalid')) || lower.includes('unable to validate email')) {
    return { kind: 'invalid_email', text: EMAIL_INCOMPLETE_TEXT, code, ...base };
  }
  if (
    SEND_FAILED_CODES.has(c) || status === 500 || status === 502 || status === 503 || status === 504 ||
    lower.includes('error sending') || lower.includes('gomail') || lower.includes('smtp') || lower.includes('could not send') || lower.includes('sending confirmation') || lower.includes('sending recovery')
  ) {
    return { kind: 'send_failed', text: SEND_FAILED_TEXT, code, ...base };
  }
  if (lower.includes('invalid login credentials')) return { kind: 'generic', text: "That email and password don't match. Check them and try again.", code, ...base };
  if (lower.includes('email not confirmed')) return { kind: 'generic', text: 'This email address is not confirmed yet. Use the sign-in link or code we sent you.', code, ...base };
  const specific = textOf(opts.serverText);
  if (specific) return { kind: 'generic', text: specific, code, ...base };
  // Anything else: one generic sentence, with the code in small print so a support request can quote it. Never the raw body.
  // Prompt 923 (C): with a reference (the screens pass one and write it to the server's log) the small print is the reference; without, the machine code as before.
  if (opts.ref) return { kind: 'generic', text: `${GENERIC_TEXT} (ref ${opts.ref})`, code, retryAfterSeconds: wait, ref: opts.ref };
  const small = code ? ` (${code})` : status ? ` (${status})` : '';
  return { kind: 'generic', text: `${GENERIC_TEXT}${small}`, code, ...base };
}

/** The sentence only. For the places that just need a string. */
export function authErrorText(err: unknown, opts: { serverText?: string; ref?: string } = {}): string {
  return describeAuthError(err, opts).text;
}

/** Truncation for what is written to the failure log: a provider can send a very long body. */
export function clipForLog(v: unknown, max = 400): string | null {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
