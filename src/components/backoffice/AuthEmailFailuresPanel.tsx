'use client';
// Prompt 911 (B.2) — sign-up and recovery emails that could NOT be sent, on Backoffice -> Email delivery. These are the
// emails Supabase Auth sends through its SMTP (sign-up code/confirmation, password recovery); the platform's own Resend
// sends are in the log below on the same page. Read from public.auth_email_failures; the provider's own text is shown
// verbatim, like the log below it. A red banner says "something is wrong right now" when there was a failure in the last
// 24 hours, so the next outage is seen the day it starts instead of a day later in Supabase's logs.
import { useEffect, useState } from 'react';

export interface AuthFailureRow {
  id: number; created_at: string; email: string; action: string; source: string;
  http_status: number | null; error_code: string | null; error_message: string | null;
}

export const ACTION_LABELS: Record<string, string> = {
  signup: 'Sign-up code / confirmation',
  resend_code: 'Resend of the code',
  recover: 'Password recovery',
  invite_signup: 'Invite sign-up',
  signup_already_registered: '"You already have an account" email',
};

function stamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export function AuthEmailFailuresView({ rows, last24h, peopleLast24h, error }: { rows: AuthFailureRow[]; last24h: number; peopleLast24h: number; error?: string }) {
  return (
    <section className="mt-6" aria-label="Failed sign-up and recovery emails" data-testid="auth-email-failures">
      <h2 className="text-sm font-semibold text-gray-900">Sign-up and recovery emails that failed</h2>
      <p className="mt-1 text-xs text-gray-500">
        The emails Supabase Auth sends (the sign-up code and confirmation, password recovery). Every refusal is recorded here with the
        provider&rsquo;s own answer, kept for 90 days.
      </p>
      {error && <p className="mt-2 text-sm text-[#B00000]">{error}</p>}
      {last24h > 0 ? (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-[#B00000]" data-testid="failures-alert">
          ⚠ {last24h} failure{last24h === 1 ? '' : 's'} in the last 24 hours, affecting {peopleLast24h} {peopleLast24h === 1 ? 'person' : 'people'}. Sign-up or recovery emails may not be arriving.
        </p>
      ) : (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" data-testid="failures-clear">No failures in the last 24 hours.</p>
      )}
      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">Email</th><th className="px-3 py-2 font-medium">What</th><th className="px-3 py-2 font-medium">Error</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 align-top" data-testid="failure-row">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{stamp(r.created_at)}</td>
                  <td className="px-3 py-2 font-mono text-gray-800">{r.email}</td>
                  <td className="px-3 py-2 text-gray-700">{ACTION_LABELS[r.action] ?? r.action}<span className="block text-[10px] text-gray-400">{r.source === 'browser' ? 'reported by the page' : 'seen by the server'}</span></td>
                  <td className="px-3 py-2 text-gray-700">
                    {[r.http_status, r.error_code].filter(Boolean).join(' · ')}
                    {r.error_message && <span className="block break-words font-mono text-[11px] text-gray-500">{r.error_message}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function AuthEmailFailuresPanel() {
  const [state, setState] = useState<{ rows: AuthFailureRow[]; last24h: number; peopleLast24h: number; error?: string }>({ rows: [], last24h: 0, peopleLast24h: 0 });
  useEffect(() => {
    fetch('/api/backoffice/auth-email-failures', { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => setState(b.ok ? { rows: b.rows ?? [], last24h: b.last24h ?? 0, peopleLast24h: b.peopleLast24h ?? 0 } : { rows: [], last24h: 0, peopleLast24h: 0, error: b.error ?? 'Could not read the failure registry.' }))
      .catch(() => setState({ rows: [], last24h: 0, peopleLast24h: 0, error: 'Could not read the failure registry.' }));
  }, []);
  return <AuthEmailFailuresView {...state} />;
}
