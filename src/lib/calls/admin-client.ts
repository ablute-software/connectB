// Prompt 918 (Adenda 2, A) — the service-role client every Calls route uses. It must NEVER let Next's fetch cache answer for it.
//
// supabase-js makes plain fetch() calls, and the App Router caches those when the route reads no cookies — `dynamic = 'force-dynamic'` alone does not stop it (the guest link route found this
// first, Prompt 537; the proven portal route has carried this same override since). In the Calls routes the cover and the logo of a call are served WITHOUT a session, so nothing in them read a
// cookie, and the cache answered for the Storage call that mints the 60-second address the bytes are fetched from: the first request got a fresh address and the picture; every later one, once
// the 60 seconds were over, got the SAME cached address back and Storage answered 400 `InvalidJWT: "exp" claim timestamp check failed` — the platform's 502 "unavailable", and a broken image
// where the cover and the logo had been (20/10/2026, INNOV-ID: it worked for a minute after each upload, then never). The same cache would have kept answering the call's own rows (status,
// deadline) from an old copy for the public link. One place decides it, so no route can forget:
// `calls-admin-client-guard.test.ts` fails when a file under the Calls code builds its own client.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** fetch that never reads from or writes to Next's data cache. */
export const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });

export function callsAdminClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false }, global: { fetch: noStoreFetch } });
}
