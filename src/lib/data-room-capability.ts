// Data Room V2 — capability probe for migration 0022 (documents.details).
// Same pattern as company-canon.ts/needs-review-ai.ts: one cheap
// column-select, cached in-memory per server instance, so the "Details"
// field UI stays hidden with a plain note until this is confirmed applied.
import 'server-only';
import { createClient } from '@supabase/supabase-js';

let detailsCached: boolean | null = null;

export async function documentDetailsAvailable(): Promise<boolean> {
  if (detailsCached !== null) return detailsCached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) { detailsCached = false; return false; }
  try {
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { error } = await admin.from('documents').select('details').limit(1);
    detailsCached = !error;
  } catch {
    detailsCached = false;
  }
  return detailsCached;
}

// F5 — probe for migration 0023's ndas table. Gates the tri-state grant
// tree's NDA-upload UI and the entity/person "NDAs on file" timeline card.
let ndaCached: boolean | null = null;

export async function ndaSystemAvailable(): Promise<boolean> {
  if (ndaCached !== null) return ndaCached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) { ndaCached = false; return false; }
  try {
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { error } = await admin.from('ndas').select('id').limit(1);
    ndaCached = !error;
  } catch {
    ndaCached = false;
  }
  return ndaCached;
}
