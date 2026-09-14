// Prompt 681 §1/§2.1 — the investor Pipeline's card/group metadata, sitting
// beside investor-pipeline-stage.ts the same way the founder side splits
// pipeline-taxonomy.ts (cards+counts) from its own status→bucket mapping.
// Six real groups, no roll-up ("Active" doesn't exist here — Nuno's own
// decision, §1: the total is a text line in the header instead).
import { INVESTOR_PIPELINE_STAGE_LABEL, type InvestorPipelineStage } from './investor-pipeline-stage';

export type InvestorPipelineCardKey = InvestorPipelineStage;

export interface InvestorPipelineCard {
  key: InvestorPipelineCardKey;
  label: string;
  /** Right-hand context line on the group header (§2.1's own table). */
  context: string;
  /** Same tone vocabulary as the founder funnel (PipelineFunnel.tsx's TONE map) — reused, not reinvented. */
  tone: 'slate' | 'blue' | 'cyan' | 'amber' | 'rose' | 'green';
  /** A `›` funnel arrow is drawn AFTER this card. */
  arrowAfter?: boolean;
  /** A vertical separator is drawn AFTER this card (before the two shelves). */
  sepAfter?: boolean;
}

// §1: New › Evaluating › Interested › Due diligence ‖ Passed · Archived.
// Arrows only between the first four; Passed/Archived are shelves with no
// arrows between them.
export const INVESTOR_PIPELINE_CARDS: InvestorPipelineCard[] = [
  { key: 'new', label: INVESTOR_PIPELINE_STAGE_LABEL.new, context: 'Take a first look', tone: 'slate', arrowAfter: true },
  { key: 'evaluating', label: INVESTOR_PIPELINE_STAGE_LABEL.evaluating, context: 'Your read is in progress', tone: 'blue', arrowAfter: true },
  { key: 'interested', label: INVESTOR_PIPELINE_STAGE_LABEL.interested, context: 'You’ve raised your hand', tone: 'cyan', arrowAfter: true },
  { key: 'due_diligence', label: INVESTOR_PIPELINE_STAGE_LABEL.due_diligence, context: 'Materials under review', tone: 'amber', sepAfter: true },
  { key: 'passed', label: INVESTOR_PIPELINE_STAGE_LABEL.passed, context: 'Closed — reason on file', tone: 'rose' },
  { key: 'archived', label: INVESTOR_PIPELINE_STAGE_LABEL.archived, context: 'Parked — reopens when their story changes', tone: 'green' },
];

export type InvestorPipelineCounts = Record<InvestorPipelineCardKey, number>;

// The six cards sum to exactly the number of unlocked rows in the list — a
// locked wave's rows never reach this function (§2.3: they're outside the
// counts entirely).
export function investorPipelineCounts(stages: InvestorPipelineStage[]): InvestorPipelineCounts {
  const counts: InvestorPipelineCounts = { new: 0, evaluating: 0, interested: 0, due_diligence: 0, passed: 0, archived: 0 };
  for (const s of stages) counts[s] += 1;
  return counts;
}
