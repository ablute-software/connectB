// Prompt 44 — survives a page reload/reopen without handing the user a
// fresh "send" button that would fire another signInWithOtp/
// resetPasswordForEmail call. Each new PKCE request overwrites the single
// code_verifier @supabase/ssr keeps locally, silently invalidating every
// link already sent — see the diagnosis in DECISIONS.md / prompt 44. This
// doesn't fix that (can't — flowType is hardcoded 'pkce' inside
// @supabase/ssr's createBrowserClient, not something callers can override),
// it just removes the most common way a user accidentally triggers it:
// reloading or reopening the tab while waiting for the email.
//
// Pure, no Supabase/network I/O — localStorage only. One shared module so
// /portal, /login, and /forgot-password can't drift into three slightly
// different cooldown behaviours.
export interface MagicLinkSentState {
  email: string;
  sentAt: string; // ISO
}

// A UX cooldown, NOT the link's real expiry (that's set server-side by
// Supabase, typically much longer). Just long enough to cover "let me go
// check my email" without permanently trapping someone who genuinely needs
// to resend — "Not you? Start over" always clears it early regardless.
export const MAGIC_LINK_COOLDOWN_MS = 10 * 60 * 1000;

const KEY = 'sd-magiclink-sent';

export function getMagicLinkSent(): MagicLinkSentState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MagicLinkSentState;
    if (!parsed?.email || !parsed?.sentAt) return null;
    const age = Date.now() - new Date(parsed.sentAt).getTime();
    if (!(age >= 0) || age > MAGIC_LINK_COOLDOWN_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setMagicLinkSent(email: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ email, sentAt: new Date().toISOString() }));
  } catch { /* private browsing / storage disabled — falls back to today's in-memory-only behaviour */ }
}

export function clearMagicLinkSent(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}
