'use client';
// Prompt 911 — the "enter your code" step as a drop-in for any page that already collected its own form (/signup, the team
// invite, the incubator team invite). The page sends the code (registerWithCode), then renders this; when the code is right
// the browser is signed in as the new account and `onVerified` runs the page's own next step (provision the organisation,
// accept the invite, ...). The mechanism is the 904 one — same routes, same limits and locks — so there is no second
// implementation to keep in step.
import { useEffect, useState } from 'react';
import { CodeStepView } from '@/components/auth/CodeStep';
import { CODE_LENGTH, RESEND_MIN_INTERVAL_SECONDS } from '@/lib/auth-code/policy';
import { resendRegistrationCode, verifyRegistrationCodeRequest } from '@/lib/auth-code/client';
import { checkPassword } from '@/lib/password-policy';

export interface CodeVerified { userId: string | null; passwordSet: boolean; warning?: string }

export function EmailCodeConfirm({ email, password: initialPassword, sentAt, message, onVerified, onChangeEmail, onResent }: {
  email: string;
  /** What the person typed in the form. Empty after a reload (it is never stored): the box asks for it again. */
  password: string;
  /** When the code was sent (ms), so the resend countdown is right after a reload too. */
  sentAt: number;
  message?: string;
  /** Runs once the code is right and the browser is signed in. A returned string is shown as an error. */
  onVerified: (v: CodeVerified) => Promise<string | void> | string | void;
  onChangeEmail: () => void;
  onResent?: (sentAt: number) => void;
}) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState(initialPassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendAt, setResendAt] = useState(sentAt + RESEND_MIN_INTERVAL_SECONDS * 1000);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [resendAt]);

  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function submit() {
    if (code.length !== CODE_LENGTH || !checkPassword(password).valid) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await verifyRegistrationCodeRequest({ email, code, password });
      if (r.kind === 'error') {
        // The code is dead (5 wrong tries): the old one is useless, and the resend gap may already be over.
        if (r.needsNewCode) { setCode(''); setResendAt(0); setNow(Date.now()); }
        if (r.wrongCode) setCode('');
        setError(r.text);
        return;
      }
      const problem = await onVerified({ userId: r.userId, passwordSet: r.passwordSet, warning: r.warning });
      if (typeof problem === 'string' && problem) setError(problem);
    } finally { setBusy(false); }
  }

  async function resend() {
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await resendRegistrationCode(email);
      const at = Date.now();
      if (r.kind === 'sent') {
        setCode('');
        setResendAt(at + r.resendAfterSeconds * 1000); setNow(at);
        setNotice('A new code is on its way. The previous one no longer works.');
        onResent?.(at);
        return;
      }
      if (r.retryAfterSeconds) { setResendAt(at + r.retryAfterSeconds * 1000); setNow(at); }
      setError(r.text);
    } finally { setBusy(false); }
  }

  return (
    <CodeStepView
      email={email} code={code} password={password} busy={busy} error={error} notice={notice} resendIn={resendIn}
      message={message ?? `We sent a code to ${email}.`} changeLabel="Change email"
      onCodeChange={(c) => { setCode(c); setError(''); }} onPasswordChange={(p) => { setPassword(p); setError(''); }}
      onSubmit={submit} onResend={resend} onChangeEmail={onChangeEmail}
    />
  );
}
