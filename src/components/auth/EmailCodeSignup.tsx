'use client';
// Prompt 904 Part B — the reusable "register with a password and a 6-digit code" component
// (docs/calls/SPEC_CALLS_V2.md §13.2–13.4). Stage 1 mounts it on the call screen; today it is
// mounted only on /auth-code-test, behind AUTH_CODE_MODE.
//
// Stages: form -> code (same page) -> startup (only when the account has no startup yet) -> done.
//  - Everything typed is kept while the code is awaited. The non-secret fields also survive a
//    reload (sessionStorage); the password never does, so after a reload the code step asks for
//    it again instead of pretending to remember it.
//  - If the window is closed instead, the account already exists: the person signs in, and the
//    link in the email lands on /set-password.
//  - Resend is available after RESEND_MIN_INTERVAL_SECONDS with a visible countdown; the SERVER
//    enforces the same gap, so changing this number in the browser buys nothing.
//
// Split in two like PasswordInput: a stateless view (rendered in tests without a DOM) and the
// stateful wrapper that talks to /api/auth-code/*.
import { useCallback, useEffect, useRef, useState } from 'react';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { PasswordRequirementsIndicator } from '@/components/auth/PasswordRequirementsIndicator';
import { checkPassword } from '@/lib/password-policy';
import { CODE_LENGTH, RESEND_MIN_INTERVAL_SECONDS, sanitizeCodeInput } from '@/lib/auth-code/policy';

export type EmailCodeStage = 'form' | 'code' | 'startup' | 'done';

export interface EmailCodeValues {
  email: string; fullName: string; startup: string; country: string; role: string; password: string; code: string;
}
export type EmailCodeField = keyof EmailCodeValues;

const INPUT = 'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm';
const BUTTON = 'w-full rounded-lg bg-[#0E7490] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40';

export function resendLabel(secondsLeft: number): string {
  return secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Send a new code';
}

export function EmailCodeSignupView({
  stage, values, busy, error, notice, resendIn, codeMessage,
  onChange, onSubmitForm, onSubmitCode, onResend, onBack, onCreateStartup,
}: {
  stage: EmailCodeStage;
  values: EmailCodeValues;
  busy: boolean;
  error: string;
  notice: string;
  /** Seconds until the resend button unlocks (0 = available now). */
  resendIn: number;
  /** The sentence shown above the code box, e.g. "We sent a code to x@y.com." */
  codeMessage: string;
  onChange: (field: EmailCodeField, value: string) => void;
  onSubmitForm: () => void;
  onSubmitCode: () => void;
  onResend: () => void;
  onBack: () => void;
  onCreateStartup: () => void;
}) {
  const field = (f: EmailCodeField) => ({ value: values[f], onChange: (e: { target: { value: string } }) => onChange(f, e.target.value), disabled: busy });
  const passwordOk = checkPassword(values.password).valid;
  const formReady = !busy && !!values.email && !!values.fullName && !!values.startup && !!values.country && !!values.role && passwordOk;

  return (
    <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" data-testid="email-code-signup" data-stage={stage}>
      {stage === 'form' && (
        <div className="space-y-2.5">
          <h1 className="text-lg font-semibold text-gray-900">Create your account</h1>
          <input type="email" autoComplete="email" placeholder="Email *" className={INPUT} {...field('email')} />
          <input autoComplete="name" placeholder="Your name *" className={INPUT} {...field('fullName')} />
          <input autoComplete="organization" placeholder="Startup *" className={INPUT} {...field('startup')} />
          <input autoComplete="country-name" placeholder="Country *" className={INPUT} {...field('country')} />
          <input autoComplete="organization-title" placeholder="Your role *" className={INPUT} {...field('role')} />
          <PasswordInput autoComplete="new-password" placeholder="Password *" className="rounded-xl border border-gray-300 px-3 py-2 text-sm" {...field('password')} />
          <PasswordRequirementsIndicator password={values.password} />
          {error && <p role="alert" className="text-xs text-[#B00000]">{error}</p>}
          <button type="button" onClick={onSubmitForm} disabled={!formReady} className={BUTTON}>
            {busy ? 'Sending code…' : 'Create account'}
          </button>
        </div>
      )}

      {stage === 'code' && (
        <div className="space-y-3">
          <h1 className="text-lg font-semibold text-gray-900">Enter your code</h1>
          <p className="text-sm text-gray-600" data-testid="code-message">{codeMessage}</p>
          <p className="text-xs text-gray-400">Check your spam folder if it does not arrive. The code is valid for 30 minutes.</p>
          <input
            inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={CODE_LENGTH + 2}
            placeholder="123456" aria-label="6-digit code" data-testid="code-input"
            className="w-full rounded-xl border border-gray-300 px-3 py-3 text-center text-2xl font-semibold tracking-[0.5em]"
            value={values.code} disabled={busy}
            onChange={(e) => onChange('code', sanitizeCodeInput(e.target.value))}
            onKeyDown={(e) => { if (e.key === 'Enter' && values.code.length === CODE_LENGTH && passwordOk && !busy) onSubmitCode(); }}
          />
          {/* After a reload the password is gone on purpose (it is never stored). */}
          {values.password === '' && (
            <div>
              <PasswordInput autoComplete="new-password" placeholder="Choose your password *" className="rounded-xl border border-gray-300 px-3 py-2 text-sm" {...field('password')} />
            </div>
          )}
          {values.password !== '' && !passwordOk && (
            <PasswordRequirementsIndicator password={values.password} />
          )}
          {notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}
          {error && <p role="alert" className="text-xs text-[#B00000]">{error}</p>}
          <button type="button" onClick={onSubmitCode} disabled={busy || values.code.length !== CODE_LENGTH || !passwordOk} className={BUTTON}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
          <div className="flex items-center justify-between text-xs">
            <button type="button" onClick={onResend} disabled={busy || resendIn > 0} data-testid="resend"
              className="font-medium text-[#0E7490] hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline">
              {resendLabel(resendIn)}
            </button>
            <button type="button" onClick={onBack} disabled={busy} className="text-gray-500 hover:underline">Use another email</button>
          </div>
        </div>
      )}

      {stage === 'startup' && (
        <div className="space-y-2.5">
          <h1 className="text-lg font-semibold text-gray-900">Create your startup</h1>
          <p className="text-sm text-gray-600">Your email is confirmed. One last step: tell us about your startup.</p>
          <input autoComplete="organization" placeholder="Startup name *" className={INPUT} {...field('startup')} />
          <input autoComplete="country-name" placeholder="Country *" className={INPUT} {...field('country')} />
          {error && <p role="alert" className="text-xs text-[#B00000]">{error}</p>}
          <button type="button" onClick={onCreateStartup} disabled={busy || !values.startup.trim() || !values.country.trim()} className={BUTTON}>
            {busy ? 'Creating…' : 'Create startup'}
          </button>
        </div>
      )}

      {stage === 'done' && (
        <div className="space-y-2 text-center">
          <h1 className="text-lg font-semibold text-gray-900">You&apos;re in</h1>
          <p className="text-sm text-gray-600">Your email is confirmed and your account is ready.</p>
          {notice && <p role="status" className="text-xs text-amber-700">{notice}</p>}
        </div>
      )}
    </div>
  );
}

const STORE_KEY = 'sherlock-auth-code-signup-v1';
type Stored = { stage: 'code'; email: string; fullName: string; startup: string; country: string; role: string; sentAt: number };

function readStored(): Stored | null {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    return s && s.stage === 'code' && typeof s.email === 'string' ? s : null;
  } catch { return null; }
}
function writeStored(s: Stored | null) {
  try {
    if (s) window.sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
    else window.sessionStorage.removeItem(STORE_KEY);
  } catch { /* private window or blocked storage: the flow still works, it just won't survive a reload */ }
}

const EMPTY: EmailCodeValues = { email: '', fullName: '', startup: '', country: '', role: '', password: '', code: '' };

async function postJson(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

export function EmailCodeSignup({ checkSessionOnMount = false, onDone }: {
  /** Stage 1: a signed-in user with no startup lands on the startup step. Off on the test page. */
  checkSessionOnMount?: boolean;
  onDone?: () => void;
}) {
  const [stage, setStage] = useState<EmailCodeStage>('form');
  const [values, setValues] = useState<EmailCodeValues>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [codeMessage, setCodeMessage] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const userIdRef = useRef<string | null>(null);

  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [resendAt]);

  // Restore the non-secret fields after a reload.
  useEffect(() => {
    const s = readStored();
    if (s) {
      setValues((v) => ({ ...v, email: s.email, fullName: s.fullName, startup: s.startup, country: s.country, role: s.role }));
      setCodeMessage(`We sent a code to ${s.email}.`);
      setResendAt(s.sentAt + RESEND_MIN_INTERVAL_SECONDS * 1000);
      setNow(Date.now());
      setStage('code');
    }
  }, []);

  const afterAuthenticated = useCallback(async () => {
    const res = await fetch('/api/auth-code/status').then((r) => r.json()).catch(() => null) as
      { authenticated?: boolean; hasStartup?: boolean; userId?: string } | null;
    if (res?.userId) userIdRef.current = res.userId;
    if (res?.authenticated && res.hasStartup === false) { setStage('startup'); return; }
    setStage('done');
    onDone?.();
  }, [onDone]);

  useEffect(() => {
    if (checkSessionOnMount && !readStored()) void afterAuthenticated();
  }, [checkSessionOnMount, afterAuthenticated]);

  const onChange = (f: EmailCodeField, value: string) => { setValues((v) => ({ ...v, [f]: value })); setError(''); };

  function rememberSent(v: EmailCodeValues, sentAt: number) {
    writeStored({ stage: 'code', email: v.email, fullName: v.fullName, startup: v.startup, country: v.country, role: v.role, sentAt });
  }

  async function submitForm() {
    setBusy(true); setError(''); setNotice('');
    try {
      const { status, json } = await postJson('/api/auth-code/register', {
        email: values.email, fullName: values.fullName, startup: values.startup, country: values.country, role: values.role, password: values.password,
      });
      if (status === 200 && json.ok) {
        const sentAt = Date.now();
        setCodeMessage(String(json.message ?? `We sent a code to ${values.email}.`));
        setResendAt(sentAt + Number(json.resendAfterSeconds ?? RESEND_MIN_INTERVAL_SECONDS) * 1000);
        setNow(sentAt);
        rememberSent(values, sentAt);
        setStage('code');
        return;
      }
      if (status === 429 && json.retryAfterSeconds) {
        // Someone already asked for a code for this email a moment ago: same screen, same wait.
        setResendAt(Date.now() + Number(json.retryAfterSeconds) * 1000);
        setNow(Date.now());
      }
      setError(String(json.error ?? 'Something went wrong. Please try again.'));
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  async function submitCode() {
    setBusy(true); setError(''); setNotice('');
    try {
      const { status, json } = await postJson('/api/auth-code/verify', {
        email: values.email, code: values.code, password: values.password,
        fullName: values.fullName, startup: values.startup, country: values.country, role: values.role,
      });
      if (status === 200 && json.ok) {
        writeStored(null);
        if (json.passwordSet === false) setNotice(String(json.warning ?? 'Your email is confirmed. Please choose a password on the next screen.'));
        await afterAuthenticated();
        return;
      }
      if (json.code === 'new_code_required') {
        // Locked: the old code is dead. The resend gap may already be over, so offer it now.
        setValues((v) => ({ ...v, code: '' }));
        setResendAt(0);
      }
      if (json.code === 'wrong_code') setValues((v) => ({ ...v, code: '' }));
      setError(String(json.error ?? 'That code did not work.'));
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  async function resend() {
    setBusy(true); setError(''); setNotice('');
    try {
      const { status, json } = await postJson('/api/auth-code/resend', { email: values.email });
      if (status === 200 && json.ok) {
        const sentAt = Date.now();
        setValues((v) => ({ ...v, code: '' }));
        setResendAt(sentAt + Number(json.resendAfterSeconds ?? RESEND_MIN_INTERVAL_SECONDS) * 1000);
        setNow(sentAt);
        rememberSent(values, sentAt);
        setNotice('A new code is on its way. The previous one no longer works.');
        return;
      }
      if (status === 429 && json.retryAfterSeconds) {
        setResendAt(Date.now() + Number(json.retryAfterSeconds) * 1000);
        setNow(Date.now());
      }
      setError(String(json.error ?? 'Something went wrong. Please try again.'));
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  async function createStartup() {
    setBusy(true); setError('');
    try {
      if (!userIdRef.current) { setError('Please sign in again to finish creating your startup.'); return; }
      const { status, json } = await postJson('/api/provision-org', {
        user_id: userIdRef.current, org_name: values.startup.trim(), country: values.country.trim(),
        full_name: values.fullName, title: values.role,
      });
      if (status >= 400 || json.ok === false) { setError(String(json.error ?? 'We could not create your startup. Please try again.')); return; }
      setStage('done');
      onDone?.();
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  function back() {
    writeStored(null);
    setValues((v) => ({ ...v, code: '' }));
    setError(''); setNotice('');
    setStage('form');
  }

  return (
    <EmailCodeSignupView
      stage={stage} values={values} busy={busy} error={error} notice={notice} resendIn={resendIn} codeMessage={codeMessage}
      onChange={onChange} onSubmitForm={submitForm} onSubmitCode={submitCode} onResend={resend} onBack={back} onCreateStartup={createStartup}
    />
  );
}
