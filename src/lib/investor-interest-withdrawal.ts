import 'server-only';
// Prompt 345 Block B — "Withdraw interest": lets an investor undo an
// 'interested' decision, but ONLY while the founder genuinely hasn't acted
// on it yet. AP-06 still means a real decision can't be silently erased
// once anything downstream happened — this isn't a reopen of that rule, it's
// a narrow window before any of its consequences exist at all.
//
// canWithdrawInterest is the fail-closed predicate, pure and unit-tested on
// its own: any signal that's true, OR unknown/indeterminate, closes the
// window. The resolver below (resolveWithdrawWindowSignals) is the only
// place that talks to the database — it decides what "true" means for each
// signal, this function never re-derives that from raw rows itself.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface WithdrawWindowSignals {
  // access_grants row for this investor/org created after the decision —
  // the founder actively invited them into the data room.
  grantCreatedAfterDecision: boolean;
  // A founder-authored deal_messages row after the decision.
  founderMessagedAfterDecision: boolean;
  // A investor_interest_levels row at level 2/3 already exists — the
  // relationship has moved past plain "interested".
  interestLevelEscalated: boolean;
  // Whether the founder's own "Respond to expressed interest" task is
  // still open. `null` means the task couldn't be found at all — treated
  // as indeterminate, not "still open", since an untracked interest could
  // just as easily mean the founder already acted through a path this
  // check can't see.
  founderTaskStillOpen: boolean | null;
}

export function canWithdrawInterest(signals: WithdrawWindowSignals): boolean {
  if (signals.grantCreatedAfterDecision) return false;
  if (signals.founderMessagedAfterDecision) return false;
  if (signals.interestLevelEscalated) return false;
  // Fail-closed: only an explicit, known `true` (the task exists and is
  // still open) keeps the window open. `false` (closed) and `null`
  // (unknown) both refuse.
  return signals.founderTaskStillOpen === true;
}

export async function resolveWithdrawWindowSignals(
  admin: SupabaseClient,
  params: { orgId: string; investorCatalogEntityId: string; decidedAt: string; investorEmails: string[] },
): Promise<WithdrawWindowSignals> {
  const { orgId, investorCatalogEntityId, decidedAt, investorEmails } = params;

  const orParts = investorEmails.flatMap((e) => [`grantee_email.eq.${e}`, `invited_email.eq.${e}`]);
  const { data: grants } = orParts.length
    ? await admin.from('access_grants').select('id').eq('org_id', orgId).gt('granted_at', decidedAt).or(orParts.join(','))
    : { data: [] as { id: string }[] };

  const { data: thread } = await admin.from('deal_threads').select('id')
    .eq('startup_org_id', orgId).eq('investor_catalog_entity_id', investorCatalogEntityId).maybeSingle();
  let founderMessagedAfterDecision = false;
  if (thread) {
    const { data: msgs } = await admin.from('deal_messages').select('id')
      .eq('thread_id', thread.id as string).eq('sender_side', 'founder').gt('created_at', decidedAt).limit(1);
    founderMessagedAfterDecision = (msgs ?? []).length > 0;
  }

  const { data: levelRows } = await admin.from('investor_interest_levels').select('id')
    .eq('org_id', orgId).eq('investor_catalog_entity_id', investorCatalogEntityId).in('level', [2, 3]).limit(1);

  const { data: delivery } = await admin.from('catalog_deliveries').select('entity_id')
    .eq('org_id', orgId).eq('catalog_id', investorCatalogEntityId).maybeSingle();
  let founderTaskStillOpen: boolean | null = null;
  if (delivery?.entity_id) {
    const { data: task } = await admin.from('tasks').select('done')
      .eq('org_id', orgId).eq('entity_id', delivery.entity_id as string).eq('source', 'investor_interest')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    founderTaskStillOpen = task ? !(task.done as boolean) : null;
  }

  return {
    grantCreatedAfterDecision: (grants ?? []).length > 0,
    founderMessagedAfterDecision,
    interestLevelEscalated: (levelRows ?? []).length > 0,
    founderTaskStillOpen,
  };
}
