// Browser-safe Supabase config + client. No server-only imports here so this
// module is importable from client components. Server helpers live in supabase-server.ts.
import { createBrowserClient } from '@supabase/ssr';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const authEnabled = !!SUPABASE_URL && !!SUPABASE_ANON;

// MatchDeal QR pairing v2 — app.sherlockdeal.com needs to see the SAME
// session sherlockdeal.com already has (spec: "sessão partilhada... cookie
// de sessão com domain=.sherlockdeal.com"). Scoping the auth cookie to the
// parent domain does this for free via @supabase/ssr's own cookieOptions —
// no manual cookie interception needed. Guarded to only the real
// sherlockdeal.com family: a cookie Domain attribute that doesn't match
// the actual host is silently REJECTED by the browser, so applying this
// unconditionally on a vercel.app preview or localhost would break login
// there entirely, not just no-op. www.sherlockdeal.com is confirmed live
// today (this exact app); app.sherlockdeal.com does not exist yet — this
// takes effect the moment it's added as a Vercel domain, no further code
// change needed.
export function shareableCookieDomain(host: string | null | undefined): string | undefined {
  if (!host) return undefined;
  const bare = host.split(':')[0].toLowerCase();
  return bare === 'sherlockdeal.com' || bare.endsWith('.sherlockdeal.com') ? '.sherlockdeal.com' : undefined;
}

export function browserClient() {
  const domain = typeof window !== 'undefined' ? shareableCookieDomain(window.location.hostname) : undefined;
  return createBrowserClient(SUPABASE_URL!, SUPABASE_ANON!, domain ? { cookieOptions: { domain } } : undefined);
}

export type Role = 'founder' | 'developer' | 'investor' | 'none';
