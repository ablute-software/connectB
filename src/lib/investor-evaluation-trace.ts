// Prompt 681 §1.1 — hasEvaluationTrace: does ANY row exist, for this
// investor firm and a given org, across the closed list of evaluation-trace
// tables the taxonomy's "Evaluating" rule reads. One query per table,
// aggregated across every org in the list at once — never N+1 per card.
//
// Three identity axes, because these tables predate this feature and each
// was keyed to whatever the investor-portal pattern of its own prompt was:
//   - investor_email: investor_diligence_checklist, investor_followups,
//     investor_tasks.
//   - investor_catalog_entity_id (the firm): investor_watches.
//   - investor_member_id (a specific seat at the firm, via
//     matchdeal_investor_members): investor_scorecard_scores (through its
//     criteria's owning member), investor_doc_scores,
//     investor_diligence_checklist... no — case_decisions/case_risks/
//     case_predictions, evaluation_snapshots. A firm-level "does ANYONE at
//     this firm have a trace" reads ANY of that firm's members' rows, not
//     just the current seat's own.
//
// Prompt 687 §2 — this used to run FIVE sequential round-trip "waves" (the
// email-keyed queries, then watches, then member-resolution, then the
// member-keyed queries, then scorecard scores) even though the first three
// have no dependency on each other at all — only member-keyed queries
// genuinely need memberIds, and scorecard scores genuinely need criteriaIds.
// Down to three real waves: everything independent of memberIds/criteriaIds
// runs together, per-wave and per-table timed (Prompt 687 §1 — measure, not
// guess) so a future regression shows up in Vercel's own logs by table name.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { timeBlock } from './pipeline-timing';

function addOrgIds(target: Set<string>, rows: { org_id?: unknown; startup_org_id?: unknown }[] | null | undefined) {
  for (const r of rows ?? []) {
    const id = (r.org_id ?? r.startup_org_id) as string | undefined;
    if (id) target.add(id);
  }
}

export async function computeEvaluationTraceOrgIds(
  admin: SupabaseClient, orgIds: string[], investorCatalogEntityId: string | null, email: string,
): Promise<Set<string>> {
  const trace = new Set<string>();
  if (orgIds.length === 0) return trace;

  // Wave 1 — every query that depends on nothing but the arguments already
  // in hand: the three investor_email-keyed tables, the firm-level watches
  // table, and resolving this firm's member ids (needed for wave 2, but the
  // resolution ITSELF has no dependency on wave 1's own results).
  const [
    { data: diligence }, { data: followups }, { data: tasks }, { data: watches }, { data: members },
  ] = await Promise.all([
    timeBlock('eval-trace.diligence', () => admin.from('investor_diligence_checklist').select('org_id').eq('investor_email', email).in('org_id', orgIds)),
    timeBlock('eval-trace.followups', () => admin.from('investor_followups').select('org_id').eq('investor_email', email).eq('done', false).in('org_id', orgIds)),
    timeBlock('eval-trace.tasks', () => admin.from('investor_tasks').select('org_id').eq('investor_email', email).eq('done', false).in('org_id', orgIds)),
    investorCatalogEntityId
      ? timeBlock('eval-trace.watches', () => admin.from('investor_watches').select('org_id').eq('investor_catalog_entity_id', investorCatalogEntityId).in('org_id', orgIds))
      : Promise.resolve({ data: [] as { org_id: string }[] }),
    investorCatalogEntityId
      ? timeBlock('eval-trace.members', () => admin.from('matchdeal_investor_members').select('id').eq('catalog_entity_id', investorCatalogEntityId))
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  addOrgIds(trace, diligence); addOrgIds(trace, followups); addOrgIds(trace, tasks); addOrgIds(trace, watches);

  if (!investorCatalogEntityId) return trace;
  const memberIds = (members ?? []).map((m) => m.id as string);
  if (memberIds.length === 0) return trace;

  // Wave 2 — the member-keyed tables, all independent of each other, all
  // needing memberIds from wave 1.
  const [{ data: docScores }, { data: caseDecisions }, { data: caseRisks }, { data: casePredictions }, { data: snapshots }, { data: criteria }] = await Promise.all([
    timeBlock('eval-trace.docScores', () => admin.from('investor_doc_scores').select('startup_org_id').in('investor_member_id', memberIds).in('startup_org_id', orgIds)),
    timeBlock('eval-trace.caseDecisions', () => admin.from('investor_case_decisions').select('startup_org_id').in('investor_member_id', memberIds).in('startup_org_id', orgIds)),
    timeBlock('eval-trace.caseRisks', () => admin.from('investor_case_risks').select('startup_org_id').in('investor_member_id', memberIds).in('startup_org_id', orgIds)),
    timeBlock('eval-trace.casePredictions', () => admin.from('investor_case_predictions').select('startup_org_id').in('investor_member_id', memberIds).in('startup_org_id', orgIds)),
    timeBlock('eval-trace.snapshots', () => admin.from('evaluation_snapshots').select('startup_org_id').in('investor_member_id', memberIds).in('startup_org_id', orgIds)),
    timeBlock('eval-trace.criteria', () => admin.from('investor_scorecard_criteria').select('id').in('investor_member_id', memberIds)),
  ]);
  addOrgIds(trace, docScores); addOrgIds(trace, caseDecisions); addOrgIds(trace, caseRisks);
  addOrgIds(trace, casePredictions); addOrgIds(trace, snapshots);

  // Wave 3 — scorecard scores, the one table genuinely two hops away
  // (criteria owns investor_member_id; scores only carry criteria_id), so
  // this alone needs criteriaIds resolved from wave 2 first.
  const criteriaIds = (criteria ?? []).map((c) => c.id as string);
  if (criteriaIds.length > 0) {
    const { data: scores } = await timeBlock('eval-trace.scorecardScores', () => admin.from('investor_scorecard_scores')
      .select('startup_org_id').in('criteria_id', criteriaIds).in('startup_org_id', orgIds));
    addOrgIds(trace, scores);
  }

  return trace;
}
