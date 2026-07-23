// Shared capability-probe factory. Every migration-gated feature (Company
// Canon, needs-review AI, document details, NDA system, entity contact
// fields) checks a cheap "does this column/table exist yet" probe and caches
// the result per server instance.
//
// BUG fixed here (founder's live session): the old probes cached a NEGATIVE
// result forever — so a server instance that first probed BEFORE a migration
// was applied would report the feature unavailable for the rest of its life,
// even after the migration landed. The founder saw "AI pre-classification
// isn't available in this workspace yet" long after applying migration 0021.
//
// Fix: positive results still cache indefinitely (a table doesn't un-exist),
// but negatives are re-probed after a short TTL so a just-applied migration
// is picked up within ~60s. One independent cache cell per returned probe.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const NEGATIVE_TTL_MS = 60_000;

export function makeCapabilityProbe(probe: (admin: SupabaseClient) => Promise<boolean>): () => Promise<boolean> {
  let cached: boolean | null = null;
  let negativeAt = 0;

  return async function available(): Promise<boolean> {
    if (cached === true) return true;
    if (cached === false && Date.now() - negativeAt < NEGATIVE_TTL_MS) return false;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !service) { cached = false; negativeAt = Date.now(); return false; }

    try {
      const admin = createClient(url, service, { auth: { persistSession: false } });
      cached = await probe(admin);
    } catch {
      cached = false;
    }
    if (cached === false) negativeAt = Date.now();
    return cached;
  };
}
