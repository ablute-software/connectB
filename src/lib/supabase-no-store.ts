// Service-role Supabase clients that never let Next's fetch cache answer for them (audit of 20/10/2026, after the Calls cover/logo incident).
//
// supabase-js makes plain fetch() calls, and the App Router's Data Cache answers a fetch that carries an Authorization header (every supabase-js
// request does) UNLESS the request has already been marked dynamic. Read in Next 14.2.35 (patch-fetch.js, `autoNoCache`), a route handler is marked
// dynamic — `store.revalidate = 0` — only by: exporting POST/DELETE/PATCH/OPTIONS (then every method of that file, its GET too), calling cookies()/headers()
// from next/headers (serverClient() does), or reading request.headers / .url / .json() / nextUrl.searchParams on a route that is NOT `dynamic = 'force-dynamic'`
// (that mode hands the handler the raw, un-proxied request, so reading it marks nothing). `dynamic = 'force-dynamic'` alone marks nothing either — the guest link
// route found it first (Prompt 537) and the Calls cover/logo broke on it on 20/10/2026 (a cached 60-second signed address, reused after it expired: Storage 400 InvalidJWT).
//
// So a GET-only route that builds its client with a bare createClient(url, serviceKey) and reads no cookie before its first query can answer from an old copy: a revoked or
// accepted invitation still "pending", a one-time "this wasn't me" token that still looks unused, a plan price edited in the backoffice and not shown. A client built here
// forces `cache: 'no-store'` on every request it makes, the REST ones and the auth-admin ones (supabase-js hands the same fetch to both), so the answer no longer depends on
// the order of the lines above it. `supabase-no-store.test.ts` fails when a GET-only route goes around it.
import { createClient, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js';

/** fetch that never reads from or writes to Next's data cache. */
export const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });

/** createClient(url, key, options) with every request forced to `cache: 'no-store'`. Everything else in `options` is passed through untouched. */
export function createNoStoreClient(url: string, key: string, options: SupabaseClientOptions<'public'> = {}): SupabaseClient {
  return createClient(url, key, { ...options, global: { ...options.global, fetch: noStoreFetch } });
}
