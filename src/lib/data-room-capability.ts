// Data Room V2 — capability probe for migration 0022 (documents.details).
// Same pattern as company-canon.ts/needs-review-ai.ts: one cheap
// column-select, cached in-memory per server instance, so the "Details"
// field UI stays hidden with a plain note until this is confirmed applied.
import 'server-only';
import { createClient } from '@supabase/supabase-js';

let cached: boolean | null = null;

export async function documentDetailsAvailable(): Promise<boolean> {
  if (cached !== null) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) { cached = false; return false; }
  try {
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { error } = await admin.from('documents').select('details').limit(1);
    cached = !error;
  } catch {
    cached = false;
  }
  return cached;
}
