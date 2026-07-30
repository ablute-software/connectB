// Investor identity verification, Fase B (prompt 64), Bloco 3 — vouching
// orchestration shared by the request/confirm routes and by
// investor-profile/route.ts's identity_status computation.
import type { SupabaseClient } from '@supabase/supabase-js';

// "Abonos só contam por entidade distinta" — two vouches from the same
// firm (e.g. two partners at the same fund) count as one. Counted by the
// VOUCHER's own linked catalog_entity_id, not by how many people vouched.
export async function countDistinctVoucherEntities(admin: SupabaseClient, requesterCatalogEntityId: string) {
  const { data } = await admin.from('investor_vouches').select('voucher_catalog_entity_id')
    .eq('requester_catalog_entity_id', requesterCatalogEntityId).eq('status', 'confirmed');
  const entityIds = new Set((data ?? []).map((v) => v.voucher_catalog_entity_id as string).filter(Boolean));
  return entityIds.size;
}

export function generateVouchToken() {
  return crypto.randomUUID().replace(/-/g, '');
}
