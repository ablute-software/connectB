// Prompt 923 — a stand-in for src/lib/supabase.ts used ONLY by the real-browser tests (rolldown aliases '@/lib/supabase' to this file): the auth calls the invitation page and the sign-in form make, answered from
// `window.__sb` so a test decides what the provider says (a code that works, a 429 with its wait, an expired code, a failure). Nothing here is imported by the app.
export const authEnabled = true;
export const SUPABASE_URL = 'http://supabase.test';
export const SUPABASE_ANON = 'anon-key-for-test';
export type Role = 'founder' | 'developer' | 'incubator' | 'investor' | 'investor_pending' | 'none';
export const shareableCookieDomain = () => undefined;

type Failure = { status: number; code?: string; message: string };
interface Config {
  user: { id: string; email: string; email_confirmed_at: string; user_metadata: Record<string, unknown> } | null;
  /** The code that works; any other is refused with `verifyFail` (default: otp_expired). */
  goodCode: string; verifyFail: Failure;
  otpFail: Failure | null;
  calls: { fn: string; args: unknown }[];
}
declare global { interface Window { __sb: Config } }

const fail = (f: Failure) => Object.assign(new Error(f.message), { status: f.status, code: f.code, name: 'AuthApiError' });

export function browserClient() {
  const cfg = () => window.__sb;
  return {
    auth: {
      getUser: async () => ({ data: { user: cfg().user }, error: null }),
      verifyOtp: async (args: { email: string; token: string }) => {
        cfg().calls.push({ fn: 'verifyOtp', args });
        if (args.token !== cfg().goodCode) return { data: { user: null }, error: fail(cfg().verifyFail) };
        cfg().user = { id: 'new-1', email: args.email, email_confirmed_at: '2026-10-28T10:00:00Z', user_metadata: {} };
        return { data: { user: cfg().user }, error: null };
      },
      signInWithOtp: async (args: unknown) => {
        cfg().calls.push({ fn: 'signInWithOtp', args });
        return cfg().otpFail ? { data: {}, error: fail(cfg().otpFail as Failure) } : { data: {}, error: null };
      },
      signInWithPassword: async (args: unknown) => { cfg().calls.push({ fn: 'signInWithPassword', args }); return { data: {}, error: fail({ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }) }; },
      signOut: async () => { cfg().calls.push({ fn: 'signOut', args: null }); cfg().user = null; try { sessionStorage.setItem('__signedOut', '1'); } catch { /* storage blocked */ } return { error: null }; },
    },
  };
}
