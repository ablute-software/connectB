// Prompt 904 Part B — the numbers and the input rules of the "register with a 6-digit code"
// flow (docs/calls/SPEC_CALLS_V2.md §13.2–13.4). Pure: no I/O, importable from the client
// component and from the server alike, so the form and the route can never disagree about
// what a valid input is.
import { checkPassword } from '@/lib/password-policy';

export const CODE_LENGTH = 6;
/** Wrong guesses allowed per code. The sixth is refused: a new code is required. */
export const MAX_WRONG_ATTEMPTS = 5;
/** Resend is refused by the SERVER before this many seconds; the UI counts down the same number. */
export const RESEND_MIN_INTERVAL_SECONDS = 60;
/** At most this many codes per email per window — stops using us as a mail cannon. */
export const MAX_SENDS_PER_WINDOW = 6;
export const SEND_WINDOW_SECONDS = 3600;
/** Per client IP, per 10 minutes. Generous on purpose: a shared office NAT must not lock out candidates. */
export const IP_REQUEST_LIMIT = 30;
export const IP_VERIFY_LIMIT = 60;
export const IP_WINDOW_SECONDS = 600;
/**
 * Every request-a-code answer takes at least this long. The "account exists" branch sends via
 * Resend, the "new" branch via Supabase; without a floor the two have different response times
 * and the timing alone would say which one ran.
 */
export const MIN_REQUEST_DURATION_MS = 1500;

export interface RegistrationProfile {
  fullName: string;
  startup: string;
  country: string;
  role: string;
}

export interface RegistrationInput extends RegistrationProfile {
  email: string;
}

export function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

// Deliberately loose: the real check is that the code arrives. This only rejects what can
// never be an address, so a typo is caught before a code is spent on it.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidEmailShape(email: string): boolean {
  return email.length <= 254 && EMAIL_SHAPE.test(email);
}

export function isValidCode(code: unknown): code is string {
  return typeof code === 'string' && new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);
}

/** Keeps digits only and caps the length — what the code box does to a pasted "123 456". */
export function sanitizeCodeInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function readProfile(body: Record<string, unknown>): RegistrationProfile {
  return {
    fullName: clean(body.fullName, 120),
    startup: clean(body.startup, 160),
    country: clean(body.country, 80),
    role: clean(body.role, 120),
  };
}

export function profileProblem(p: RegistrationProfile): string | null {
  if (!p.fullName) return 'Please enter your name.';
  if (!p.startup) return 'Please enter your startup.';
  if (!p.country) return 'Please enter your country.';
  if (!p.role) return 'Please enter your role.';
  return null;
}

export function registrationProblem(email: string, p: RegistrationProfile, password: string): string | null {
  if (!isValidEmailShape(email)) return 'Please enter a valid email address.';
  const profile = profileProblem(p);
  if (profile) return profile;
  if (!checkPassword(password).valid) return 'That password does not meet the requirements.';
  return null;
}

/** The ONE sentence shown for a successful request, whether or not an account exists. */
export function codeSentMessage(email: string): string {
  return `We sent a code to ${email}.`;
}
