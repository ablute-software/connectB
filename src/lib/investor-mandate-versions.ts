// Prompt 715 Pedido D — a new snapshot every time the investor's declared
// mandate (the About form) or their context card changes, so a later
// exclusion/thesis edit never mixes with the history recorded under the
// mandate that was active at the time. Cheap and append-only: no row is
// ever updated once written.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MandateSnapshotInput {
  sectors: string[]; stagesInvested: string[]; geographies: string[]; instruments: string[];
  ticketMin: number | null; ticketMax: number | null;
  exclusionsSectors: string[] | null; exclusionsNotes: string | null;
  context: {
    priorityNote: string | null; pauseNewCandidates: boolean; capacity: string | null; expiresAt: string | null;
  } | null;
}

export async function currentMandateVersion(admin: SupabaseClient, investorCatalogEntityId: string): Promise<{ id: string; versionNo: number } | null> {
  const { data } = await admin.from('investor_mandate_versions').select('id, version_no')
    .eq('investor_catalog_entity_id', investorCatalogEntityId).order('version_no', { ascending: false }).limit(1).maybeSingle();
  return data ? { id: data.id as string, versionNo: data.version_no as number } : null;
}

// Best-effort, like every signal-ledger write in this codebase — a failure
// to record a version must never block the About/context save that
// triggered it. Returns the new version's id, or null on failure.
export async function bumpMandateVersion(
  admin: SupabaseClient, investorCatalogEntityId: string, snapshot: MandateSnapshotInput, createdBy: string | null,
): Promise<string | null> {
  try {
    const current = await currentMandateVersion(admin, investorCatalogEntityId);
    const { data, error } = await admin.from('investor_mandate_versions').insert({
      investor_catalog_entity_id: investorCatalogEntityId,
      version_no: (current?.versionNo ?? 0) + 1,
      snapshot, created_by: createdBy,
    }).select('id').single();
    if (error) throw error;
    return data.id as string;
  } catch (e) {
    console.error('bumpMandateVersion failed:', e);
    return null;
  }
}
