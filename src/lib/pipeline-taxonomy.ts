// Prompt 650 — one taxonomy for the whole Pipeline screen. The old screen said
// the same thing in three vocabularies (top cards, group headers, STAGE column)
// and the numbers did not add up: the five cards summed to 816 in a universe of
// 759 because "Active" was a roll-up counted alongside the buckets it contains,
// and "Frozen" hid `passed` inside `dormant`. This module is the ONE place the
// mapping status → card/group lives, so the cards, the list groups and the
// counts can never drift from each other again.
//
// Decided by Nuno (Prompt 650 v2 §1). Presentation only — the `entity_status`
// enum keeps all seven values and there is NO migration. `contacted`,
// `in_conversation` and `invested` render inside one "Contacted" card/group,
// but each row still shows its TRUE state in the STAGE column (see
// pipelineStageLabel), so the single invested fund stays identifiable and no
// information is lost.

// The six things the top funnel shows. `active` is a ROLL-UP (total − passed),
// not a bucket an entity lives in — it deliberately overlaps the others.
export type PipelineCardKey =
  | 'not_contacted' | 'contacted' | 'diligence' | 'active' | 'passed' | 'frozen';

// The five real buckets. Every entity lands in exactly one, and they sum to the
// account total. `active` is intentionally NOT here — it is a header number, not
// a group.
export type PipelineGroupKey =
  | 'not_contacted' | 'contacted' | 'diligence' | 'passed' | 'frozen';

export const PIPELINE_GROUPS: PipelineGroupKey[] =
  ['not_contacted', 'contacted', 'diligence', 'passed', 'frozen'];

// status → bucket. The merge (§1.1) happens here and nowhere else. Every value
// of the entity_status enum maps to exactly one bucket, which is what keeps the
// "each investor in one place, buckets sum to the total" invariant true.
export function pipelineGroupForStatus(status: string | null | undefined): PipelineGroupKey {
  switch (status) {
    case 'not_contacted': return 'not_contacted';
    case 'contacted':
    case 'in_conversation':
    case 'invested': return 'contacted';
    case 'diligence': return 'diligence';
    case 'passed': return 'passed';
    case 'dormant': return 'frozen';
    // The enum has no other value; an unexpected one is treated as still-to-
    // reach so it stays visible and in-play rather than silently vanishing.
    default: return 'not_contacted';
  }
}

// The TRUE per-row state for the STAGE column — never the merged group. Frozen
// sub-states (stale / no-reply / not-a-fit) are layered on top of this by the
// caller via pillLabelForFrozenState; here `dormant` is just "Frozen".
export function pipelineStageLabel(status: string | null | undefined): string {
  switch (status) {
    case 'not_contacted': return 'Not contacted';
    case 'contacted': return 'Contacted';
    case 'in_conversation': return 'In conversation';
    case 'invested': return 'Invested';
    case 'diligence': return 'Due diligence';
    case 'passed': return 'Passed';
    case 'dormant': return 'Frozen';
    default: return status ?? '—';
  }
}

export type PipelineCard = {
  key: PipelineCardKey;
  label: string;
  /** Right-hand context line on the group header (§2). Empty for the roll-up. */
  context: string;
  /** Semantic tone; the UI layer maps it to concrete classes. */
  tone: 'slate' | 'blue' | 'amber' | 'muted' | 'rose' | 'cyan';
  /** total − passed; overlaps the buckets, is not a drop target, has no group. */
  rollup?: boolean;
  /** A `›` funnel arrow is drawn AFTER this card. */
  arrowAfter?: boolean;
  /** A vertical separator is drawn AFTER this card (before the shelves). */
  sepAfter?: boolean;
};

// The six cards, in the fixed order of §1: arrows only along the funnel
// (Not contacted › Contacted › Due diligence), then a separator, then the
// roll-up and the two shelves with no arrows between them.
export const PIPELINE_CARDS: PipelineCard[] = [
  { key: 'not_contacted', label: 'Not contacted', context: 'Start outreach', tone: 'slate', arrowAfter: true },
  { key: 'contacted', label: 'Contacted', context: 'Active discussions', tone: 'blue', arrowAfter: true },
  { key: 'diligence', label: 'Due diligence', context: 'Materials under review', tone: 'amber', sepAfter: true },
  { key: 'active', label: 'Active', context: '', tone: 'muted', rollup: true },
  { key: 'passed', label: 'Passed', context: 'Closed — no longer in play', tone: 'rose' },
  { key: 'frozen', label: 'Frozen', context: 'Parked — revisit later', tone: 'cyan' },
];

export type PipelineCounts = Record<PipelineCardKey, number>;

// Counts for every card from a flat list of statuses. The five bucket counts
// sum to statuses.length; `active` is the roll-up total − passed.
export function pipelineCounts(statuses: (string | null | undefined)[]): PipelineCounts {
  const g: Record<PipelineGroupKey, number> =
    { not_contacted: 0, contacted: 0, diligence: 0, passed: 0, frozen: 0 };
  for (const s of statuses) g[pipelineGroupForStatus(s)] += 1;
  return {
    not_contacted: g.not_contacted,
    contacted: g.contacted,
    diligence: g.diligence,
    passed: g.passed,
    frozen: g.frozen,
    active: statuses.length - g.passed,
  };
}
