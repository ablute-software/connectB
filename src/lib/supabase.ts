// Browser-safe Supabase config + client. No server-only imports here so this
// module is importable from client components. Server helpers live in supabase-server.ts.
import { createBrowserClient } from '@supabase/ssr';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const authEnabled = !!SUPABASE_URL && !!SUPABASE_ANON;

export function browserClient() {
  return createBrowserClient(SUPABASE_URL!, SUPABASE_ANON!);
}

export type Role = 'founder' | 'developer' | 'investor' | 'none';
