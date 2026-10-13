'use client';
// Prompt 904 / 911 — the "enter your 6-digit code" box, ONE view for every place that registers with a code: the
// 904 component (EmailCodeSignup), /signup, the team invite and the incubator team invite. Stateless on purpose, like
// PasswordInput, so it renders in tests without a DOM; the stateful wrapper is EmailCodeConfirm.tsx.
//
// After a reload the password is gone on purpose (it is never stored), so the box asks for it again.
import { PasswordInput } from '@/components/auth/PasswordInput';
import { PasswordRequirementsIndicator } from '@/components/auth/PasswordRequirementsIndicator';
import { checkPassword } from '@/lib/password-policy';
import { CODE_LENGTH, sanitizeCodeInput } from '@/lib/auth-code/policy';
import { AuthMessage } from '@/components/auth/AuthMessage';

const BUTTON = 'w-full rounded-lg bg-[#0E7490] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40';

export function resendLabel(secondsLeft: number): string {
  return secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Send a new code';
}

export function CodeStepView({
  email, code, password, busy, error, notice, resendIn, message, changeLabel,
  onCodeChange, onPasswordChange, onSubmit, onResend, onChangeEmail,
}: {
  email: string;
  code: string;
  password: string;
  busy: boolean;
  error: string;
  notice: string;
  /** Seconds until the resend button unlocks (0 = available now). */
  resendIn: number;
  /** The sentence above the box, e.g. "We sent a code to x@y.com." */
  message: string;
  /** "Use another email" on the 904 page; "Change email" where the email is part of a bigger form. */
  changeLabel?: string;
  onCodeChange: (code: string) => void;
  onPasswordChange: (password: string) => void;
  onSubmit: () => void;
  onResend: () => void;
  onChangeEmail: () => void;
}) {
  const passwordOk = checkPassword(password).valid;
  const field = { value: password, onChange: (e: { target: { value: string } }) => onPasswordChange(e.target.value), disabled: busy };
  return (
    <div className="space-y-3" data-testid="code-step" data-email={email}>
      <h1 className="text-lg font-semibold text-gray-900">Enter your code</h1>
      <p className="text-sm text-gray-600" data-testid="code-message">{message}</p>
      <p className="text-xs text-gray-400">Check your spam folder if it does not arrive. The code is valid for 30 minutes.</p>
      <input
        inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={CODE_LENGTH + 2}
        placeholder="123456" aria-label="6-digit code" data-testid="code-input"
        className="w-full rounded-xl border border-gray-300 px-3 py-3 text-center text-2xl font-semibold tracking-[0.5em]"
        value={code} disabled={busy}
        onChange={(e) => onCodeChange(sanitizeCodeInput(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter' && code.length === CODE_LENGTH && passwordOk && !busy) onSubmit(); }}
      />
      {/* After a reload the password is gone on purpose (it is never stored). */}
      {password === '' && (
        <div>
          <PasswordInput autoComplete="new-password" placeholder="Choose your password *" className="rounded-xl border border-gray-300 px-3 py-2 text-sm" {...field} />
        </div>
      )}
      {password !== '' && !passwordOk && (
        <PasswordRequirementsIndicator password={password} />
      )}
      {notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}
      {error && <p role="alert" className="text-xs text-[#B00000]" data-testid="code-error"><AuthMessage text={error} /></p>}
      <button type="button" onClick={onSubmit} disabled={busy || code.length !== CODE_LENGTH || !passwordOk} className={BUTTON} data-testid="code-confirm">
        {busy ? 'Checking…' : 'Confirm'}
      </button>
      <div className="flex items-center justify-between text-xs">
        <button type="button" onClick={onResend} disabled={busy || resendIn > 0} data-testid="resend"
          className="font-medium text-[#0E7490] hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline">
          {resendLabel(resendIn)}
        </button>
        <button type="button" onClick={onChangeEmail} disabled={busy} className="text-gray-500 hover:underline" data-testid="change-email">{changeLabel ?? 'Use another email'}</button>
      </div>
      <p className="text-[11px] text-gray-400" data-testid="link-alternative">You can also click the button in the same email instead of typing the code.</p>
    </div>
  );
}
