'use client';
// Prompt 127 Bloco A (addenda §2) — the same signOut()-then-redirect handler
// and base classes were copied byte-for-byte three times (founder sidebar,
// investor sidebar, investor mobile-header). One handler now.
import { browserClient } from '@/lib/supabase';

const BASE = 'rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50';

export function LogoutButton({ className }: { className?: string }) {
  async function logout() {
    try { await browserClient().auth.signOut(); } catch { /* ignore */ }
    window.location.href = '/login';
  }
  return <button onClick={logout} className={className ? `${BASE} ${className}` : BASE}>Log out</button>;
}
