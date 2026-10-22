'use client';
// Prompt 905 → 907 (I1) — the page behind a published call's link (spec §13). It shows the call's header and, below it, what the person
// in front of it needs: the registration box (the 904 component with variant="call") with "Already have an account? Sign in" always
// visible, the startup step for an account that has no startup yet, or their application. The link keeps its memory:
//   - registering sends the confirmation email's link back to THIS page (emailRedirectTo = /call/<token>);
//   - "Sign in" goes to /login?next=/call/<token>;
//   - a draft is reopened where the applicant left it.
// Public path; the data comes from /api/calls/public/<token>[/session]. A link that does not work (no such call, not published, archived,
// no form, or Calls switched off) says so like any other dead link and never reveals which.
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { LogoLockup } from '@/components/Logo';
import { EmailCodeSignup } from '@/components/auth/EmailCodeSignup';
import { CallIntro, CallMiniHeader, ctaLabel, type PublicCallInfo } from '@/components/calls/applicant/CallHeader';
import { ApplicationArea, type CallSession } from '@/components/calls/applicant/ApplicationArea';
import { GONE_MESSAGE } from '@/lib/calls/deletion';

export default function CallLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [call, setCall] = useState<PublicCallInfo | null | undefined>(undefined);
  const [gone, setGone] = useState(false);                                  // the call was deleted: "This call is no longer available"
  const [session, setSession] = useState<CallSession | undefined>(undefined);
  // Prompt 918 (Adenda 1, C): the page opens on the call's presentation; "Start application" goes on to registration or to the form. `?start=1` skips it (a link back from an email).
  const [stage, setStage] = useState<'intro' | 'apply'>('intro');
  useEffect(() => { if (new URLSearchParams(window.location.search).get('start') === '1') setStage('apply'); }, []);

  const loadSession = useCallback(async () => {
    try {
      const r = await fetch(`/api/calls/public/${encodeURIComponent(token)}/session`, { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      setSession(r.ok && d?.ok ? (d as CallSession) : { authenticated: false, hasStartup: false });
    } catch { setSession({ authenticated: false, hasStartup: false }); }
  }, [token]);

  useEffect(() => {
    fetch(`/api/calls/public/${encodeURIComponent(token)}`, { cache: 'no-store' }).then(async (r) => {
      const d = await r.json().catch(() => null);
      setGone(r.status === 410 && d?.gone === true);
      setCall(r.ok && d?.ok ? (d as PublicCallInfo) : null);
      if (r.ok && d?.ok) void loadSession();
    }).catch(() => setCall(null));
  }, [token, loadSession]);

  const here = `/call/${token}`;
  const open = call?.phase === 'open';

  const intro = call && stage === 'intro';

  return (
    <main className="flex min-h-screen items-start justify-center bg-gray-50 p-0 sm:items-center sm:p-6">
      <div className={`w-full max-w-xl bg-white shadow-xl ${intro ? 'min-h-screen sm:min-h-0 sm:rounded-2xl' : 'rounded-2xl p-6 sm:p-8'}`}>
        {intro ? (
          <>
            <CallIntro call={call} cta={ctaLabel(call.phase, session?.application ?? null)} onStart={() => setStage('apply')} />
            <div className="px-5 pb-5 pt-2 text-[#0E7490] sm:px-8"><LogoLockup size={18} accentClassName="text-[#2a7f8e]" /></div>
          </>
        ) : (
        <>
        <div className="mb-5 text-[#0E7490]"><LogoLockup size={26} accentClassName="text-[#2a7f8e]" /></div>
        {call === undefined ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : call === null && gone ? (
          <div data-testid="call-gone">
            <h1 className="text-lg font-semibold text-gray-900">{GONE_MESSAGE}</h1>
            <p className="mt-2 text-sm text-gray-500">The organisation that ran this call has taken it down. If you applied to it, your applications are in <Link href="/calls" className="font-semibold text-[#0E7490] hover:underline">Calls → My applications</Link> for a while longer.</p>
          </div>
        ) : call === null ? (
          <>
            <h1 className="text-lg font-semibold text-gray-900">This link is not available</h1>
            <p className="mt-2 text-sm text-gray-500">The call may not be open yet, or the link may be wrong. Please check it with whoever sent it to you.</p>
          </>
        ) : (
          <>
            <CallMiniHeader call={call} onAbout={() => setStage('intro')} />
            {call.message && <p className="mt-4 rounded-lg bg-[#E8F4F8] px-4 py-3 text-sm font-medium text-[#0E7490]" data-testid="call-message">{call.message}</p>}
            <div className="mt-6">
              {session === undefined ? (
                <p className="text-sm text-gray-400">Loading…</p>
              ) : !session.authenticated ? (
                open ? (
                  <div data-testid="registration">
                    <div className="flex justify-center">
                      <EmailCodeSignup variant="call" redirectPath={here} onDone={() => void loadSession()} />
                    </div>
                    <p className="mt-4 text-center text-sm text-gray-600">
                      Already have an account?{' '}
                      <Link href={`/login?next=${encodeURIComponent(here)}`} className="font-semibold text-[#0E7490] hover:underline" data-testid="signin-link">Sign in</Link>
                    </p>
                  </div>
                ) : (
                  <p className="text-center text-sm text-gray-600">
                    Already have an account?{' '}
                    <Link href={`/login?next=${encodeURIComponent(here)}`} className="font-semibold text-[#0E7490] hover:underline" data-testid="signin-link">Sign in</Link>
                  </p>
                )
              ) : !session.hasStartup ? (
                open ? (
                  <div data-testid="startup-step" className="flex justify-center">
                    <EmailCodeSignup variant="call" initialStage="startup" redirectPath={here} onDone={() => void loadSession()} />
                  </div>
                ) : null
              ) : (
                <ApplicationArea token={token} call={call} session={session} onChanged={() => void loadSession()} />
              )}
            </div>
          </>
        )}
        </>
        )}
      </div>
    </main>
  );
}
