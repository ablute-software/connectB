'use client';
// Prompt 335 §D3a — opening someone's personal connect link. Authenticated
// already: consume immediately. Not authenticated: stash the token and send
// them to /signup — network/page.tsx checks for a stashed token on mount
// and consumes it once a session exists, so completing signup and then
// visiting My Network (which is exactly where they were headed) finishes
// the loop without any change to the signup flow itself.
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { authEnabled } from '@/lib/supabase';
import { PENDING_CONNECT_TOKEN_KEY } from '@/lib/network';

export default function ConnectLinkPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<'checking' | 'done' | 'error'>('checking');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!authEnabled) { setStatus('error'); setMessage('Not available in this workspace.'); return; }
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then((me) => {
      if (!me.user) {
        sessionStorage.setItem(PENDING_CONNECT_TOKEN_KEY, token);
        router.replace('/signup');
        return;
      }
      fetch('/api/network/connect-link/consume', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
      }).then((r) => r.json()).then((b) => {
        setStatus(b.ok ? 'done' : 'error');
        setMessage(b.ok ? 'Connection request sent — check My Network to accept it.' : (b.error ?? 'Could not use this link.'));
        if (b.ok) setTimeout(() => router.replace('/network'), 1500);
      });
    }).catch(() => { setStatus('error'); setMessage('Something went wrong.'); });
  }, [token, router]);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-6 text-center">
      <h1 className="text-lg font-bold text-gray-900">Sherlock Deal</h1>
      <p className="mt-4 text-sm text-gray-600">
        {status === 'checking' ? 'One moment…' : message}
      </p>
    </div>
  );
}
