// IRM_SPEC §11 — Company Canon capability probe. Overnight-block rule: main
// must be indistinguishable from today until migration 0020 is applied, so
// every canon-dependent code path (Company nav link, composer provenance
// gate, alignment checks) asks this first rather than assuming the table
// exists. One cheap `select ... limit 1`, cached in-memory per server
// instance — worst case one extra query per cold start, not per request.
import 'server-only';
import { createClient } from '@supabase/supabase-js';

let cached: boolean | null = null;

export async function companyCanonAvailable(): Promise<boolean> {
  if (cached !== null) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) { cached = false; return false; }
  try {
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { error } = await admin.from('company_facts').select('id').limit(1);
    cached = !error;
  } catch {
    cached = false;
  }
  return cached;
}
