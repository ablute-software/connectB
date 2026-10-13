'use client';
// Prompt 906 §C — what "Forgot your password?" shows after "Send reset link". Its own component (the page file may
// export nothing but the page) so a test can render the real thing.
//
// This screen used to announce a sent link for ANY address. The server answers "ok" whether or not an account exists
// (on purpose: it must not reveal who has one), so a founder who typed a different address than the one they signed
// up with waited for an email that could never come. The sentence is now true in both cases (src/lib/auth-copy.ts),
// and the address is shown so a typo can be seen.
import { FORGOT_PASSWORD_SENT_COPY } from '@/lib/auth-copy';

export function ForgotPasswordSent({ email, onStartOver }: { email: string; onStartOver: () => void }) {
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">
      <p>{FORGOT_PASSWORD_SENT_COPY}</p>
      <p className="mt-1 text-gray-500">
        You entered <span className="font-medium text-gray-700">{email}</span>. Open the link on this same device and browser you used to request it — requesting again before you click it will invalidate this one.
      </p>
      <button onClick={onStartOver} className="mt-1 text-gray-400 hover:underline">Wrong address? Start over</button>
    </div>
  );
}
