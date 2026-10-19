'use client';
// Prompt 904 Part B — the reusable "register with a password and a 6-digit code" component
// (docs/calls/SPEC_CALLS_V2.md §13.2–13.4). Prompt 907 mounts it on the call screen (/call/<token>) with variant="call": the
// same component, no second implementation — it adds the explanation of the free account, the consents (Terms required,
// newsletter optional), "Create account & continue", the redirect that brings the email link back to the call, and — once the code
// is right — it provisions the startup with what was typed (the registration data becomes the account and the startup's About).
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
import { RESEND_MIN_INTERVAL_SECONDS } from '@/lib/auth-code/policy';
import { CodeStepView, resendLabel } from '@/components/auth/CodeStep';
import { AuthMessage } from '@/components/auth/AuthMessage';

export { resendLabel };

export type EmailCodeStage = 'form' | 'code' | 'startup' | 'done';

export interface EmailCodeValues {
  email: string; fullName: string; startup: string; country: string; role: string; password: string; code: string;
}
export type EmailCodeField = keyof EmailCodeValues;

const INPUT = 'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm';
const BUTTON = 'w-full rounded-lg bg-[#0E7490] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40';

export function EmailCodeSignupView({
  stage, values, busy, error, notice, resendIn, codeMessage,
  onChange, onSubmitForm, onSubmitCode, onResend, onBack, onCreateStartup,
  variant = 'default', agreedToTerms = false, wantsNewsletter = false, onToggleTerms, onToggleNewsletter,
}: {
  /** 'call' (Prompt 907): the registration on a call's link — explains the free account, asks for the consents. */
  variant?: 'default' | 'call';
  agreedToTerms?: boolean;
  wantsNewsletter?: boolean;
  onToggleTerms?: (v: boolean) => void;
  onToggleNewsletter?: (v: boolean) => void;
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
  const termsOk = variant !== 'call' || agreedToTerms;
  const formReady = !busy && !!values.email && !!values.fullName && !!values.startup && !!values.country && !!values.role && passwordOk && termsOk;

  return (
    <div className={variant === 'call' ? 'w-full rounded-xl border border-gray-200 bg-white p-5' : 'w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl'} data-testid="email-code-signup" data-stage={stage}>
      {stage === 'form' && (
        <div className="space-y-2.5">
          <h1 className="text-lg font-semibold text-gray-900">{variant === 'call' ? 'Create your account to apply' : 'Create your account'}</h1>
          {variant === 'call' && (
            <p className="text-xs text-gray-500" data-testid="free-account-note">
              We create a free Sherlock Deal account for you, to save and follow your applications. There are additional plans for other tools; you do not need one to apply.
            </p>
          )}
          <input type="email" autoComplete="email" placeholder="Email *" className={INPUT} {...field('email')} />
          <input autoComplete="name" placeholder="Your name *" className={INPUT} {...field('fullName')} />
          <input autoComplete="organization" placeholder="Startup *" className={INPUT} {...field('startup')} />
          <input autoComplete="country-name" placeholder="Country *" className={INPUT} {...field('country')} />
          <input autoComplete="organization-title" placeholder="Your role *" className={INPUT} {...field('role')} />
          <PasswordInput autoComplete="new-password" placeholder="Password *" className="rounded-xl border border-gray-300 px-3 py-2 text-sm" {...field('password')} />
          <PasswordRequirementsIndicator password={values.password} />
          {variant === 'call' && (
            <div className="space-y-2" data-testid="consents">
              <label className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-xs text-gray-500">
                <input type="checkbox" checked={wantsNewsletter} onChange={(e) => onToggleNewsletter?.(e.target.checked)} disabled={busy} className="mt-0.5 accent-[#0E7490]" />
                Send me product updates and news by email (optional)
              </label>
              <label className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-sm text-gray-700">
                <input type="checkbox" checked={agreedToTerms} onChange={(e) => onToggleTerms?.(e.target.checked)} disabled={busy} className="mt-0.5 accent-[#0E7490]" data-testid="terms-checkbox" />
                <span>I have read and accept the <a href="/terms" target="_blank" rel="noreferrer" className="font-semibold text-[#0E7490] hover:underline">Terms &amp; Conditions</a>. *</span>
              </label>
            </div>
          )}
          {error && <p role="alert" className="text-xs text-[#B00000]"><AuthMessage text={error} /></p>}
          <button type="button" onClick={onSubmitForm} disabled={!formReady} className={BUTTON}>
            {busy ? 'Sending code…' : variant === 'call' ? 'Create account & continue' : 'Create account'}
          </button>
        </div>
      )}

      {stage === 'code' && (
        <CodeStepView
          email={values.email} code={values.code} password={values.password} busy={busy} error={error} notice={notice}
          resendIn={resendIn} message={codeMessage}
          onCodeChange={(c) => onChange('code', c)} onPasswordChange={(p) => onChange('password', p)}
          onSubmit={onSubmitCode} onResend={onResend} onChangeEmail={onBack}
        />
      )}

      {stage === 'startup' && (
        <div className="space-y-2.5">
          <h1 className="text-lg font-semibold text-gray-900">Create your startup</h1>
          <p className="text-sm text-gray-600">Your email is confirmed. One last step: tell us about your startup.</p>
          <input autoComplete="organization" placeholder="Startup name *" className={INPUT} {...field('startup')} />
          <input autoComplete="country-name" placeholder="Country *" className={INPUT} {...field('country')} />
          {error && <p role="alert" className="text-xs text-[#B00000]"><AuthMessage text={error} /></p>}
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
type Stored = { stage: 'code'; email: string; fullName: string; startup: string; country: string; role: string; sentAt: number; agreedToTerms?: boolean; wantsNewsletter?: boolean };

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

export function EmailCodeSignup({ checkSessionOnMount = false, onDone, variant = 'default', redirectPath, initialStage = 'form' }: {
  /** Stage 1: a signed-in user with no startup lands on the startup step. Off on the test page. */
  checkSessionOnMount?: boolean;
  onDone?: () => void;
  /** 'call' (Prompt 907): the registration on a call's link. */
  variant?: 'default' | 'call';
  /** Where the link in the confirmation email brings the person back to (a path of this site): the call and its page. */
  redirectPath?: string;
  /** 'startup': the person already has an account but no startup (e.g. an investor): ask for the startup straight away. */
  initialStage?: 'form' | 'startup';
}) {
  const [stage, setStage] = useState<EmailCodeStage>(initialStage === 'startup' ? 'startup' : 'form');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [wantsNewsletter, setWantsNewsletter] = useState(false);
  const [values, setValues] = useState<EmailCodeValues>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [codeMessage, setCodeMessage] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const userIdRef = useRef<string | null>(null);
  const variantRef = useRef(variant);
  variantRef.current = variant;
  // Set below: creates the startup from the typed values (call variant only).
  const autoProvisionRef = useRef<(() => Promise<void>) | null>(null);

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
      setAgreedToTerms(s.agreedToTerms === true); setWantsNewsletter(s.wantsNewsletter === true);
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
    if (res?.authenticated && res.hasStartup === false) {
      // A call's registration already collected the startup, the country, the name and the role: create the startup with them (the
      // registration data becomes the account and the startup's About) instead of asking again. Anything missing -> ask.
      if (variantRef.current === 'call' && autoProvisionRef.current) { await autoProvisionRef.current(); return; }
      setStage('startup'); return;
    }
    setStage('done');
    onDone?.();
  }, [onDone]);

  useEffect(() => {
    if (checkSessionOnMount && !readStored()) void afterAuthenticated();
  }, [checkSessionOnMount, afterAuthenticated]);

  // Someone already signed in who has no startup (e.g. an investor account): we only need the user id for the startup step.
  useEffect(() => {
    if (initialStage !== 'startup') return;
    fetch('/api/auth-code/status').then((r) => r.json()).then((res: { userId?: string }) => { if (res?.userId) userIdRef.current = res.userId; }).catch(() => {});
  }, [initialStage]);

  const onChange = (f: EmailCodeField, value: string) => { setValues((v) => ({ ...v, [f]: value })); setError(''); };

  function rememberSent(v: EmailCodeValues, sentAt: number) {
    writeStored({ stage: 'code', email: v.email, fullName: v.fullName, startup: v.startup, country: v.country, role: v.role, sentAt, agreedToTerms, wantsNewsletter });
  }

  async function submitForm() {
    setBusy(true); setError(''); setNotice('');
    try {
      const { status, json } = await postJson('/api/auth-code/register', {
        email: values.email, fullName: values.fullName, startup: values.startup, country: values.country, role: values.role, password: values.password, strict: true,
        redirectPath,
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
        fullName: values.fullName, startup: values.startup, country: values.country, role: values.role, strict: true,
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
      const { status, json } = await postJson('/api/auth-code/resend', { email: values.email, redirectPath });
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
        ...(variant === 'call' ? { marketing_opt_in: wantsNewsletter } : {}),
      });
      if (status >= 400 || json.ok === false) { setError(String(json.error ?? 'We could not create your startup. Please try again.')); return; }
      // The Terms were accepted in the form (call variant): record it now that there is a session. Best effort, as /signup does.
      if (variant === 'call' && agreedToTerms) await fetch('/api/terms/accept', { method: 'POST' }).catch(() => {});
      setStage('done');
      onDone?.();
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
    } finally { setBusy(false); }
  }
  // Right after the code: with everything typed, create the startup without asking again; if something is missing, ask for it.
  autoProvisionRef.current = values.startup.trim() && values.country.trim() ? createStartup : null;

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
      variant={variant} agreedToTerms={agreedToTerms} wantsNewsletter={wantsNewsletter}
      onToggleTerms={setAgreedToTerms} onToggleNewsletter={setWantsNewsletter}
    />
  );
}
