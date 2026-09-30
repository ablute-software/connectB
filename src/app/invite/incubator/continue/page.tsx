'use client';
// Prompt I-01 §C.2 — where the login/signup detour returns to. The token was
// kept in this browser's localStorage (never in a URL query or an e-mail
// link built by us), and goes back into a path here.
import { useEffect, useState } from 'react';
import { INCUBATOR_INVITE_STORAGE_KEY, incubatorInvitePath, type StoredIncubatorInvite } from '@/lib/incubators';

export default function IncubatorInviteContinuePage() {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(INCUBATOR_INVITE_STORAGE_KEY);
      const stored = raw ? (JSON.parse(raw) as StoredIncubatorInvite) : null;
      if (stored?.token) { window.location.replace(incubatorInvitePath(stored.token)); return; }
    } catch { /* fall through */ }
    setMissing(true);
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] p-4">
      <div className="max-w-md rounded-2xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-700 shadow-sm">
        {missing ? 'Não encontrámos o convite neste browser. Abre de novo o link do e-mail da incubadora.' : 'A abrir o convite…'}
      </div>
    </div>
  );
}
