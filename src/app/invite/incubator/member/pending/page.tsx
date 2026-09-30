'use client';
// Prompt I-01c §A.3 — where an account invited to an ecosystem organisation's
// team lands when it came in through the ordinary door (normal sign-in, or the
// e-mail confirmation link). Accepts every pending team invite for the
// confirmed address and continues to the Ecosystem workspace. Nothing here
// ever offers "finish your startup account".
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { browserClient, authEnabled } from '@/lib/supabase';
import { PENDING_MEMBER_INVITE_PATH } from '@/lib/landing-redirect';

type State = 'working' | 'signed_out' | 'none' | 'error' | 'demo';

export default function PendingMemberInvitePage() {
  const [state, setState] = useState<State>('working');

  useEffect(() => {
    if (!authEnabled) { setState('demo'); return; }
    browserClient().auth.getUser().then(async ({ data }) => {
      if (!data.user) { setState('signed_out'); return; }
      const r = await fetch('/api/invite/incubator/member/accept-pending', { method: 'POST' }).then((x) => x.json()).catch(() => null);
      if (!r?.ok) { setState('error'); return; }
      if (r.accepted > 0) { window.location.replace('/ecosystem'); return; }
      setState('none');
    });
  }, []);

  async function signOut() {
    await browserClient().auth.signOut().catch(() => {});
    window.location.href = '/login';
  }

  const box = (c: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-xl" data-testid="pending-member-invite">{c}</div>
    </div>
  );

  if (state === 'working') return box(<p className="text-sm text-gray-500">Opening your team invite…</p>);
  if (state === 'demo') return box(<p className="text-sm text-amber-800">Demo mode — team invites need a connected database.</p>);
  if (state === 'signed_out') {
    return box(
      <div>
        <p className="text-sm text-gray-700">Sign in with the address your invite was sent to.</p>
        <Link href={`/login?next=${encodeURIComponent(PENDING_MEMBER_INVITE_PATH)}`} className="mt-3 inline-block rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white">Sign in</Link>
      </div>,
    );
  }
  return box(
    <div>
      <p className="text-sm text-gray-700">
        {state === 'none'
          ? 'This invite is no longer valid — ask the organisation to invite you again.'
          : 'We could not open your invite right now. Try again in a moment.'}
      </p>
      <button className="mt-4 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700" onClick={signOut}>Sign out</button>
    </div>,
  );
}
