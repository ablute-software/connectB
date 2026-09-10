import type { SupabaseClient } from '@supabase/supabase-js';

// Prompt 882 Part A — the org's first REAL action inside Readiness & Train,
// not merely opening the tab. Guarded (`is('readiness_train_first_used_at',
// null)`) so only the first genuine action ever sets it, and a failure here
// must never fail the action that triggered it — whatever the founder was
// actually waiting on (a review, a graded session, a blueprint read, a
// market-data pull) is what matters, this is a side note on top of it.
export async function markReadinessTrainFirstUsed(admin: SupabaseClient, orgId: string): Promise<void> {
  await admin.from('orgs').update({ readiness_train_first_used_at: new Date().toISOString() })
    .eq('id', orgId).is('readiness_train_first_used_at', null).then(() => {}, () => {});
}
