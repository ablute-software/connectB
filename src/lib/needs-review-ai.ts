// Needs-review redesign — capability probe for migration 0021
// (interactions.classified_by, entities.notes). Same pattern as
// company-canon.ts: one cheap column-select, cached in-memory per server
// instance, so every dependent code path (the batch pre-classification pass,
// the metadata-card routine, the "AI-classified" filter/revert UI) asks
// this first instead of assuming the columns exist.
import 'server-only';
import { createClient } from '@supabase/supabase-js';

let cached: boolean | null = null;

export async function needsReviewAiAvailable(): Promise<boolean> {
  if (cached !== null) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) { cached = false; return false; }
  try {
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { error } = await admin.from('interactions').select('classified_by').limit(1);
    cached = !error;
  } catch {
    cached = false;
  }
  return cached;
}
