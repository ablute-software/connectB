// Founder-feedback batch 2, item 1 — capability probe for migration 0024's
// entities.email/phone/address (and, since it's the same migration,
// people.identity_verified/gender). Same pattern as data-room-capability.ts:
// one cheap column-select, cached in-memory per server instance, so the
// entity contact-edit UI and the quick-create-person flow stay inert with a
// plain note until this is confirmed applied.
import 'server-only';
import { createClient } from '@supabase/supabase-js';

let cached: boolean | null = null;

export async function entityContactFieldsAvailable(): Promise<boolean> {
  if (cached !== null) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) { cached = false; return false; }
  try {
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { error } = await admin.from('entities').select('email').limit(1);
    cached = !error;
  } catch {
    cached = false;
  }
  return cached;
}
