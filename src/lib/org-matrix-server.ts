// Batch 3 C — server-side helper: load an org's resolved permission matrix.
// Reads the orgs.permission_matrix jsonb overrides (migration 0026) with a
// given service-role client and resolves them against the defaults. If the
// column doesn't exist yet (pre-0026) the select errors and we fall back to
// DEFAULT_MATRIX — so enforcement behaves exactly as today until applied.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveMatrix, type MatrixCapability, type MatrixOverrides } from './org-permissions';
import type { OrgRole } from './permissions';

export async function loadOrgMatrix(admin: SupabaseClient, orgId: string): Promise<Record<MatrixCapability, OrgRole[]>> {
  try {
    const { data, error } = await admin.from('orgs').select('permission_matrix').eq('id', orgId).maybeSingle();
    if (error) return resolveMatrix(null);
    return resolveMatrix((data?.permission_matrix as MatrixOverrides | null) ?? null);
  } catch {
    return resolveMatrix(null);
  }
}
