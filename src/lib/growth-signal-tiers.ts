// Prompt 517 — the growth-signal hierarchy: 15 kinds of traction a founder can
// point at, ordered strongest first (index 0 = strongest). Agreed with Nuno,
// final version.
//
// SINGLE SOURCE. Two very different consumers read this list:
//   - the AI composer (src/app/api/compose/route.ts) — so a draft leads with
//     the strongest signal available and never dresses a weak one (tiers
//     10-15, especially interest with nothing committed) up as a closed deal;
//   - the Roadmap's empty-state checklist (RoadmapStarterChecklist.tsx) — the
//     same 15 items as a deterministic "what has already happened?" prompt
//     that works with no documents and no AI at all.
// Neither may restate the list inline: two copies is how the composer's idea
// of "strong" and the founder-facing wording start to drift apart.
//
// The ORDER is the product decision here. Everything above ~9 is something
// that happened to the company (money, usage, signed commitments); 10-15 are
// real but softer — other people's money, other people's opinions, potential.
// Deliberately NOT a field on CompanyFact: there is no tier column anywhere,
// no migration. The model maps a fact onto this list by judgment from its
// category + statement, exactly as it already picks which single fact to lead
// with today. Revisit only if real use shows prompt text isn't enough.

// The five default Roadmap lanes (RoadmapPanel seeds these on first use).
// Lives here rather than only in RoadmapPanel.tsx so `defaultLane` below can
// be typed against the real labels and drift between the two is a type error
// rather than a silently mismatched string.
export const DEFAULT_LANES: { label: string; color: 'blue' | 'green' | 'amber' | 'purple' | 'teal'; shape: 'rounded' }[] = [
  { label: 'Technology & Product', color: 'blue', shape: 'rounded' },
  { label: 'Market & Commercial', color: 'green', shape: 'rounded' },
  { label: 'Funding', color: 'amber', shape: 'rounded' },
  { label: 'Team & Company', color: 'purple', shape: 'rounded' },
  { label: 'Regulatory & IP', color: 'teal', shape: 'rounded' },
];

export type DefaultLaneLabel =
  | 'Technology & Product' | 'Market & Commercial' | 'Funding' | 'Team & Company' | 'Regulatory & IP';

export interface GrowthSignalTier {
  id: string;
  /** Founder-facing wording. Also what becomes the roadmap event's title. */
  label: string;
  /** Suggested lane only — the founder can always override it in the UI. */
  defaultLane: DefaultLaneLabel;
}

// Strongest first. 'Regulatory & IP' is deliberately unmapped: nothing in a
// generic traction list is inherently regulatory, and guessing one from a
// healthtech-shaped assumption would be worse than letting the founder
// reassign it when it genuinely applies.
export const GROWTH_SIGNAL_TIERS: readonly GrowthSignalTier[] = [
  { id: 'recurring-revenue', label: 'Paid, recurring revenue with a signed contract', defaultLane: 'Market & Commercial' },
  { id: 'large-one-off-contract', label: 'A large one-off contract with a recognizable customer', defaultLane: 'Market & Commercial' },
  { id: 'sustained-growth', label: 'Sustained growth in revenue or usage', defaultLane: 'Market & Commercial' },
  { id: 'high-retention', label: 'High retention / low churn among paying customers', defaultLane: 'Market & Commercial' },
  { id: 'inbound-demand', label: 'Organic/inbound demand — customers reaching out unprompted', defaultLane: 'Market & Commercial' },
  { id: 'active-usage', label: 'Active usage without monetization yet — real DAU/MAU intensity', defaultLane: 'Market & Commercial' },
  { id: 'validated-pilot', label: 'A validated pilot with a locked protocol and success criteria', defaultLane: 'Market & Commercial' },
  { id: 'letter-of-intent', label: 'A letter of intent (LOI) or non-binding commitment from a credible party', defaultLane: 'Market & Commercial' },
  { id: 'strategic-partnership', label: 'A strategic partnership or distribution agreement, even pre-revenue', defaultLane: 'Market & Commercial' },
  { id: 'investors-committed', label: 'Other investors already committed to this round', defaultLane: 'Funding' },
  { id: 'reinvestment-oversubscribed', label: 'Existing investors reinvesting, or signs the round is oversubscribed', defaultLane: 'Funding' },
  { id: 'team', label: 'Team — founder-market fit, prior exits, notable hires, personal awards', defaultLane: 'Team & Company' },
  { id: 'market-timing', label: 'Market timing or a regulatory tailwind', defaultLane: 'Market & Commercial' },
  { id: 'differentiation-ip', label: 'Defensible product/technology differentiation or IP', defaultLane: 'Technology & Product' },
  { id: 'press-recognition', label: 'Press, institutional awards, or third-party recognition with no commitment attached', defaultLane: 'Market & Commercial' },
];

/** 1-based rank as written in the hierarchy; 1 is strongest. */
export function tierRank(id: string): number | null {
  const i = GROWTH_SIGNAL_TIERS.findIndex((t) => t.id === id);
  return i < 0 ? null : i + 1;
}

// FNV-1a, 32-bit. Any stable string hash would do; this one is short, has no
// dependencies and doesn't need to be cryptographic — it only has to give the
// same answer for the same input on every render and every reload.
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The checklist is shown deliberately OUT of strength order (Nuno's explicit
 * ask): a list that reads top-to-bottom as best-to-worst invites the founder
 * to answer the first few and treat the rest as beneath them, when the whole
 * point is to surface whatever actually happened.
 *
 * Shuffled per org, but STABLY — seeded by the org id, so the founder sees
 * the same order every time they open the page. A plain Math.random() shuffle
 * would reorder the list on every render and every reload, which reads as a
 * broken page, not as variety. Ties (equal hashes) fall back to id so the
 * result is fully determined.
 */
export function shuffledTiersForOrg(orgId: string): GrowthSignalTier[] {
  return [...GROWTH_SIGNAL_TIERS].sort((a, b) => {
    const ha = hash32(`${orgId}:${a.id}`);
    const hb = hash32(`${orgId}:${b.id}`);
    return ha === hb ? a.id.localeCompare(b.id) : ha - hb;
  });
}

/**
 * The hierarchy as prompt text for the composer. Numbered, strongest first —
 * the numbering IS the instruction, so it has to survive into the prompt.
 */
export function growthSignalTierPromptList(): string {
  return GROWTH_SIGNAL_TIERS.map((t, i) => `${i + 1}. ${t.label}`).join('\n');
}
