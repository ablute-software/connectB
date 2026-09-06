'use client';
// Prompt 127 Bloco A (addenda §2) — the same signOut()-then-redirect handler
// and base classes were copied byte-for-byte three times (founder sidebar,
// investor sidebar, investor mobile-header). One handler now.
import { browserClient } from '@/lib/supabase';

const BASE_LIGHT = 'rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50';
// Prompt 585 §A — dark theme, used only by the back-office sidebar footer;
// founder/investor never pass `theme`, so BASE_LIGHT is unaffected.
const BASE_DARK = 'rounded-lg border border-[var(--sb-border)] px-2 py-1 text-[11px] text-[var(--sb-dim)] hover:bg-white/5';

export function LogoutButton({ className, compact, theme = 'light' }: {
  className?: string;
  // Prompt 576 §5 — the back-office's collapsed ~64px rail has no room for
  // the text label; every existing caller (founder, investor) leaves this
  // unset and is unaffected.
  compact?: boolean;
  theme?: 'light' | 'dark';
}) {
  async function logout() {
    try { await browserClient().auth.signOut(); } catch { /* ignore */ }
    window.location.href = '/login';
  }
  const base = theme === 'dark' ? BASE_DARK : BASE_LIGHT;
  return (
    <button onClick={logout} title={compact ? 'Log out' : undefined} className={className ? `${base} ${className}` : base}>
      {compact ? '⏻' : 'Log out'}
    </button>
  );
}
