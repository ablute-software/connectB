// Prompt 681 §1 — the investor Pipeline's one taxonomy, replacing five
// overlapping vocabularies (decision / archive / wave / interest ladder /
// per-card relationship-state line) with a single derived stage. Pure
// function, same pattern as currentInterestLevel (investor-interest-level.ts)
// — every fact it needs is passed in, already loaded by the caller for the
// card; this never touches Supabase itself.
//
// The founder NEVER sees this stage — Evaluating in particular is the
// investor's own private read on their own work (CLAUDE.md's root rule:
// the existence of an evaluation is not visible to the startup). No
// founder-side code may import this file — see this repo's own grep check
// in investor-pipeline-stage.test.ts's header comment.
export type InvestorPipelineStage = 'new' | 'evaluating' | 'interested' | 'due_diligence' | 'passed' | 'archived';

export const INVESTOR_PIPELINE_STAGE_LABEL: Record<InvestorPipelineStage, string> = {
  new: 'New',
  evaluating: 'Evaluating',
  interested: 'Interested',
  due_diligence: 'Due diligence',
  passed: 'Passed',
  archived: 'Archived',
};

export interface InvestorPipelineStageInput {
  // investor_relationship_decisions' most recent row for this org, or null
  // if none exists yet. A 'passed' decision is final (AP-06) and always
  // wins regardless of every other signal below.
  latestDecision: 'interested' | 'passed' | null;
  // investor_archive_entries has a row for this org with reopened_at is
  // null — i.e. currently archived. Archiving tidies, it doesn't decide
  // (345): it only wins over "interested", never over "passed" or over an
  // active due-diligence signal that arrived after the archive.
  isArchived: boolean;
  // investor_interest_levels: level 3 status='granted' for this org — the
  // founder approved contact. A 'pending' level-3 request does NOT count
  // here (pending never promotes past Interested — same rule the ladder
  // itself already uses).
  hasGrantedLevel3: boolean;
  // The SAME predicate that already decides "Access granted" on today's
  // per-card status line: an active data-room grant for this firm+org pair
  // (access_grants, via activeGrantOrgIds). A founder can open the data
  // room without going through the level-3 request flow at all, and that
  // must still read as Due diligence.
  hasActiveDataRoomGrant: boolean;
  // Does ANY row exist, for this investor firm and this org, in the closed
  // list of evaluation-trace tables (see investor-evaluation-trace.ts):
  // investor_scorecard_scores, investor_doc_scores,
  // investor_diligence_checklist, investor_case_decisions,
  // investor_case_risks, investor_case_predictions, evaluation_snapshots,
  // investor_followups (done=false), investor_tasks (done=false),
  // investor_watches. Computed by the caller, aggregated across the whole
  // list in one pass per table — never re-derived per card.
  hasEvaluationTrace: boolean;
}

// Precedence top to bottom — the first rule that matches wins. Order is the
// whole point of this function; do not reorder without re-reading the six
// rows in Prompt 681 §1.1's table and the "notes de precedência" beneath it.
export function investorPipelineStage(input: InvestorPipelineStageInput): InvestorPipelineStage {
  if (input.latestDecision === 'passed') return 'passed';
  if (input.isArchived) return 'archived';
  if (input.hasGrantedLevel3 || input.hasActiveDataRoomGrant) return 'due_diligence';
  if (input.latestDecision === 'interested') return 'interested';
  if (input.hasEvaluationTrace) return 'evaluating';
  return 'new';
}

// The row's Etapa pill detail suffix (§2.4 point 5): "Interested · Full
// profile", "Due diligence · Contact granted" vs "Due diligence · Data
// room". null when the stage has no further detail to show.
export interface InvestorPipelineStageDetailInput {
  hasGrantedLevel2: boolean;
  hasGrantedLevel3: boolean;
}

export function investorPipelineStageDetail(stage: InvestorPipelineStage, input: InvestorPipelineStageDetailInput): string | null {
  if (stage === 'interested' && input.hasGrantedLevel2) return 'Full profile';
  if (stage === 'due_diligence') return input.hasGrantedLevel3 ? 'Contact granted' : 'Data room';
  return null;
}
