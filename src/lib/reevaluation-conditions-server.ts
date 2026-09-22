import 'server-only';
// Prompt 716 Pedido A — the write side of a reevaluation condition, split
// out of reevaluation-conditions.ts specifically because it needs
// investor-watching-db's requestWatch(), which is itself `import
// 'server-only'` — pulling it into the shared file broke PipelinePanel.tsx's
// client bundle the moment that component imported anything from it (see
// that file's own header comment for the exact error).
import type { SupabaseClient } from '@supabase/supabase-js';
import { requestWatch, type WatchStatus } from './investor-watching-db';
import { conditionNeedsConsent, type ConditionKind } from './reevaluation-conditions';

export interface RecordConditionInput {
  episodeId: string; orgId: string; investorCatalogEntityId: string;
  obstacle: string; conditionKind: ConditionKind; conditionValue?: string | null;
  decidedBy: string; investorEmail: string; isTestOrInternal: boolean;
}

// Pedido A §2 — the consent/reminder wiring. A condition that depends on
// startup facts gets a watch REQUEST through the same double-opt-in flow
// investor_watches already is (Prompt 348) — never a bypass. A date
// condition is the investor's own reminder (investor_followups, reused,
// never a second mechanism). "Never show again" needs neither.
export async function recordReevaluationCondition(
  admin: SupabaseClient, input: RecordConditionInput,
): Promise<{ ok: true; conditionId: string; watchStatus: WatchStatus | null } | { ok: false; error: string }> {
  let watchId: string | null = null;
  let followupId: string | null = null;
  let watchStatus: WatchStatus | null = null;

  if (conditionNeedsConsent(input.conditionKind)) {
    const result = await requestWatch(admin, input.orgId, input.investorCatalogEntityId);
    if (!result.ok) return { ok: false, error: result.error };
    watchId = result.watch.id;
    watchStatus = result.watch.status;
  } else if (input.conditionKind === 'date' && input.conditionValue) {
    const { data: followup, error } = await admin.from('investor_followups').insert({
      org_id: input.orgId, investor_email: input.investorEmail,
      note: 'Reevaluation date you set', remind_at: input.conditionValue,
    }).select('id').single();
    if (error) return { ok: false, error: error.message };
    followupId = followup.id as string;
  }

  const { data: condition, error } = await admin.from('investor_reevaluation_conditions').insert({
    episode_id: input.episodeId, org_id: input.orgId, investor_catalog_entity_id: input.investorCatalogEntityId,
    obstacle: input.obstacle, condition_kind: input.conditionKind, condition_value: input.conditionValue ?? null,
    watch_id: watchId, followup_id: followupId, decided_by: input.decidedBy,
    review_by: input.conditionKind === 'date' && input.conditionValue ? input.conditionValue : null,
    definitive_pass: input.conditionKind === 'never_show_again',
    is_test_or_internal: input.isTestOrInternal,
  }).select('id').single();
  if (error) return { ok: false, error: error.message };

  return { ok: true, conditionId: condition.id as string, watchStatus };
}
