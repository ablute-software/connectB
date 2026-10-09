// Prompt 904 Part B — the decision logic of "register with a 6-digit code", with every side
// effect behind a port. The routes wire the ports to Supabase/Resend; the tests wire them to
// fakes, which is how the guarantees below are checked without a database or a mailbox.
//
// Who guarantees what (spec §13.2–13.4):
//   random, server-generated, single-use ... Supabase Auth (OTP in auth.one_time_tokens)
//   expires ................................ Supabase Auth (mailer_otp_exp)
//   wrong code never confirms .............. Supabase Auth (verifyOtp)
//   new code invalidates the old one ....... Supabase Auth, ONE OTP slot per user and type —
//                                            to be proved against production, not assumed
//                                            (see the check in docs/calls/ETAPA0_PARTE_B)
//   5 wrong attempts -> new code ........... US: auth_code_reserve_attempt (Supabase only
//                                            limits per IP, and every candidate shares ours)
//   resend not before 60 s, hourly cap ..... US: auth_code_reserve_send
//   never reveals whether an account exists  US: identical answer on every branch + a floor
//                                            on the response time (this file)
//   typed password only after the code ..... US: the account is born with a random password;
//                                            the one the person typed is applied after the
//                                            code is verified, so nobody can register
//                                            someone else's email with a password of theirs
import {
  IP_REQUEST_LIMIT, IP_VERIFY_LIMIT, IP_WINDOW_SECONDS, MAX_SENDS_PER_WINDOW, MAX_WRONG_ATTEMPTS,
  MIN_REQUEST_DURATION_MS, RESEND_MIN_INTERVAL_SECONDS, SEND_WINDOW_SECONDS,
  codeSentMessage, isValidCode, isValidEmailShape, profileProblem, registrationProblem,
  type RegistrationProfile,
} from './policy';
import { checkPassword } from '@/lib/password-policy';

export interface SendReservation { allowed: boolean; reason?: 'too_early' | 'hourly_cap'; retryAfterSeconds: number }
export interface AttemptReservation { allowed: boolean; reason?: 'no_code' | 'locked'; attemptsLeft: number }

export interface AuthCodePorts {
  /** True when this IP is over its limit (records the hit first). */
  ipLimited(ip: string, kind: 'request' | 'verify'): Promise<boolean>;
  reserveSend(email: string): Promise<SendReservation>;
  reserveAttempt(email: string): Promise<AttemptReservation>;
  markUsed(email: string): Promise<void>;
  userState(email: string): Promise<{ exists: boolean; confirmed: boolean }>;
  /** Create the unconfirmed account (random password) and make Supabase mail the code. */
  createAccountAndSendCode(email: string, profile: RegistrationProfile): Promise<void>;
  /** Make Supabase mail a fresh code for an existing UNCONFIRMED account. */
  resendCode(email: string): Promise<void>;
  /** Tell the holder of an existing, confirmed account that they already have one. */
  sendAlreadyRegisteredEmail(email: string): Promise<void>;
  /** Ask Supabase to check the code; on success the browser session is established. */
  verifyCode(email: string, code: string): Promise<{ ok: boolean; userId?: string }>;
  /** Apply the typed password + profile to the now-confirmed, now-authenticated account. */
  finalizeAccount(userId: string, password: string, profile: RegistrationProfile): Promise<{ ok: boolean; error?: string }>;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Server-side log of a provider failure we deliberately do not show (no-oracle). */
  logError(where: string, err: unknown): void;
}

export type RequestResult =
  | { status: 200; body: { ok: true; message: string; resendAfterSeconds: number } }
  | { status: 400; body: { ok: false; code: 'invalid_input'; error: string } }
  | { status: 429; body: { ok: false; code: 'too_early' | 'hourly_cap' | 'ip_limited'; error: string; retryAfterSeconds: number } };

export type VerifyResult =
  | { status: 200; body: { ok: true; passwordSet: boolean; warning?: string } }
  | { status: 400; body: { ok: false; code: 'invalid_input'; error: string } }
  | { status: 400; body: { ok: false; code: 'wrong_code'; error: string; attemptsLeft: number } }
  | { status: 400; body: { ok: false; code: 'new_code_required'; error: string } }
  | { status: 429; body: { ok: false; code: 'ip_limited'; error: string; retryAfterSeconds: number } };

function waitText(seconds: number): string {
  return seconds >= 60 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
}

/**
 * Register (allowCreate) or resend (!allowCreate). The answer is the same sentence whether the
 * email has no account, an unconfirmed one or a confirmed one; only the email that goes out
 * differs, and the response takes at least MIN_REQUEST_DURATION_MS on every branch.
 */
export async function requestCode(
  ports: AuthCodePorts,
  input: { email: string; profile: RegistrationProfile; password?: string; ip: string },
  opts: { allowCreate: boolean },
): Promise<RequestResult> {
  // Malformed input is the caller's own mistake and says nothing about any account, so it
  // may answer immediately (no floor needed) and does not spend a send.
  if (opts.allowCreate) {
    const problem = registrationProblem(input.email, input.profile, input.password ?? '');
    if (problem) return { status: 400, body: { ok: false, code: 'invalid_input', error: problem } };
  } else if (!isValidEmailShape(input.email)) {
    return { status: 400, body: { ok: false, code: 'invalid_input', error: 'Please enter a valid email address.' } };
  }

  const startedAt = ports.now();
  const finish = async <T,>(result: T): Promise<T> => {
    const left = MIN_REQUEST_DURATION_MS - (ports.now() - startedAt);
    if (left > 0) await ports.sleep(left);
    return result;
  };

  if (await ports.ipLimited(input.ip, 'request')) {
    return finish({
      status: 429 as const,
      body: { ok: false as const, code: 'ip_limited' as const, error: 'Too many requests from your network. Please wait a few minutes.', retryAfterSeconds: IP_WINDOW_SECONDS },
    });
  }

  // State exists for EVERY email, so this answer cannot tell an account from a stranger.
  const slot = await ports.reserveSend(input.email);
  if (!slot.allowed) {
    const code = slot.reason === 'hourly_cap' ? 'hourly_cap' as const : 'too_early' as const;
    return finish({
      status: 429 as const,
      body: {
        ok: false as const, code,
        error: code === 'hourly_cap'
          ? `Too many codes requested. Please try again in ${waitText(slot.retryAfterSeconds)}.`
          : `Please wait ${waitText(slot.retryAfterSeconds)} before asking for another code.`,
        retryAfterSeconds: slot.retryAfterSeconds,
      },
    });
  }

  try {
    const state = await ports.userState(input.email);
    if (state.exists && state.confirmed) await ports.sendAlreadyRegisteredEmail(input.email);
    else if (state.exists) await ports.resendCode(input.email);
    else if (opts.allowCreate) await ports.createAccountAndSendCode(input.email, input.profile);
    // else: resend for an email with no account — nothing to send, and nothing to say.
  } catch (err) {
    // Deliberately not shown: a provider error that only some branches can raise would be an
    // oracle. The person sees the countdown, and can ask again when it ends.
    ports.logError('requestCode', err);
  }

  return finish({
    status: 200 as const,
    body: { ok: true as const, message: codeSentMessage(input.email), resendAfterSeconds: RESEND_MIN_INTERVAL_SECONDS },
  });
}

export async function verifyRegistrationCode(
  ports: AuthCodePorts,
  input: { email: string; code: string; password: string; profile: RegistrationProfile; ip: string },
): Promise<VerifyResult> {
  if (!isValidEmailShape(input.email)) return { status: 400, body: { ok: false, code: 'invalid_input', error: 'Please enter a valid email address.' } };
  if (!isValidCode(input.code)) return { status: 400, body: { ok: false, code: 'invalid_input', error: 'The code has 6 digits.' } };
  if (!checkPassword(input.password).valid) return { status: 400, body: { ok: false, code: 'invalid_input', error: 'That password does not meet the requirements.' } };
  const profile = profileProblem(input.profile);
  if (profile) return { status: 400, body: { ok: false, code: 'invalid_input', error: profile } };

  if (await ports.ipLimited(input.ip, 'verify')) {
    return { status: 429, body: { ok: false, code: 'ip_limited', error: 'Too many attempts from your network. Please wait a few minutes.', retryAfterSeconds: IP_WINDOW_SECONDS } };
  }

  // Reserve first, verify second: the attempt is spent even if this request dies below, and
  // two parallel guesses each consume one.
  const attempt = await ports.reserveAttempt(input.email);
  if (!attempt.allowed) {
    return { status: 400, body: { ok: false, code: 'new_code_required', error: 'This code can no longer be used. Please request a new one.' } };
  }

  const result = await ports.verifyCode(input.email, input.code);
  if (!result.ok || !result.userId) {
    if (attempt.attemptsLeft <= 0) {
      return { status: 400, body: { ok: false, code: 'new_code_required', error: 'That was the last attempt for this code. Please request a new one.' } };
    }
    return {
      status: 400,
      body: {
        ok: false, code: 'wrong_code', attemptsLeft: attempt.attemptsLeft,
        error: `That code didn't work. ${attempt.attemptsLeft} ${attempt.attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`,
      },
    };
  }

  await ports.markUsed(input.email);
  const done = await ports.finalizeAccount(result.userId, input.password, input.profile);
  if (!done.ok) {
    // The code WAS right: the account is confirmed and the person is signed in. Only the
    // password step failed (e.g. the project's own password policy refused it), so say so
    // instead of pretending the whole thing failed; /set-password finishes the job.
    return {
      status: 200,
      body: { ok: true, passwordSet: false, warning: done.error ?? 'Your email is confirmed, but we could not save your password. Please choose one on the next screen.' },
    };
  }
  return { status: 200, body: { ok: true, passwordSet: true } };
}

export const AUTH_CODE_LIMITS = {
  MAX_WRONG_ATTEMPTS, MAX_SENDS_PER_WINDOW, SEND_WINDOW_SECONDS, RESEND_MIN_INTERVAL_SECONDS,
  IP_REQUEST_LIMIT, IP_VERIFY_LIMIT, IP_WINDOW_SECONDS,
} as const;
