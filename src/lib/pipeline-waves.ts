// Prompt 850 §C — how the investor Pipeline's cards are grouped, and what
// each group is called. Pure: no Supabase client, no React, so the labels
// the panel renders and the grouping the server computes are pinned by the
// same unit tests (pipeline-waves.test.ts).
//
// The bug this closes. investor-pipeline.ts pushed the relationship cards
// as waves[0] and the panel labelled every group `Wave {index + 1}` — so a
// single "Invited" card became "WAVE 1", the first genuine discovery wave
// became "WAVE 2", and its cards carried a `W2` badge. No wave 1 of
// discovery had ever existed. The code's own comment said a relationship
// card "was never subject to wave doseamento" and then numbered it as a
// wave anyway. Nuno's screenshot, 04/09.
//
// So the payload distinguishes the two kinds instead of making the client
// infer them from a position: `kind: 'relationships'` (no number, ever) and
// `kind: 'discovery'` with its own `discoveryIndex` counting from 0. `index`
// stays exactly as it was — it is the DOM id and the scroll target the
// panel already uses ("Review the wave above"), and it must keep counting
// every group including the relationship one — but nothing reads it for a
// label any more.
//
// WAVE_SIZE stays 8 (Nuno's explicit choice, 04/09): 8 shown, the rest
// unlock as the wave is treated.
export const WAVE_SIZE = 8;

export type PipelineWaveKind = 'relationships' | 'discovery';

export interface PipelineWave<T> {
  /** Position among ALL groups, relationship group included. DOM id / scroll
   *  target only — never a label. Kept for compatibility. */
  index: number;
  kind: PipelineWaveKind;
  /** 0-based, discovery groups only; null for the relationship group. The
   *  label is discoveryIndex + 1, so discovery always starts at "Wave 1". */
  discoveryIndex: number | null;
  items: T[];
  unlocked: boolean;
  /** Set by the API route when it strips a locked wave's card data. */
  hiddenCount?: number;
}

// Prompt 345 §A.3 — pure, unit-tested on its own: whether a still-`open`
// card should nonetheless count as "treated" for wave-dosage purposes.
// Archiving no longer writes a pass swipe (see /api/portal/archive), so a
// card can be simultaneously isArchived AND status 'open' — without this,
// that card would sit forever as untreated and block every wave behind it.
// Tidying up IS treating it (Nuno's own call, documented in the prompt).
// Moved here from investor-pipeline.ts by Prompt 850 §C so all the wave
// mechanics have one home.
export function isTreatedForWaveDosage(card: { status: string; isArchived?: boolean }): boolean {
  return card.status !== 'open' || !!card.isArchived;
}

/**
 * Prompt 850 §C. The relationship group is never wave-gated (the
 * relationship already exists — there is nothing left to unlock by treating
 * other cards first) and never numbered. Discovery is chunked by WAVE_SIZE,
 * each chunk unlocked only once every card before it has been treated.
 */
export function buildPipelineWaves<T extends { status: string; isArchived?: boolean }>(
  relationshipCards: T[],
  admittedDiscoveryCards: T[],
): PipelineWave<T>[] {
  const waves: PipelineWave<T>[] = [];
  if (relationshipCards.length > 0) {
    waves.push({ index: waves.length, kind: 'relationships', discoveryIndex: null, items: relationshipCards, unlocked: true });
  }
  for (let i = 0; i < admittedDiscoveryCards.length; i += WAVE_SIZE) {
    const items = admittedDiscoveryCards.slice(i, i + WAVE_SIZE);
    const priorTreated = admittedDiscoveryCards.slice(0, i).every(isTreatedForWaveDosage);
    waves.push({
      index: waves.length,
      kind: 'discovery',
      discoveryIndex: i / WAVE_SIZE,
      items,
      unlocked: i === 0 || priorTreated,
    });
  }
  return waves;
}

// The two strings the panel renders, here rather than inline in the JSX so
// they are testable and cannot diverge between the group header and the
// per-card badge.
export const RELATIONSHIP_GROUP_LABEL = 'Already in touch with you';

export function waveGroupLabel(wave: Pick<PipelineWave<unknown>, 'kind' | 'discoveryIndex'>): string {
  return wave.kind === 'relationships' ? RELATIONSHIP_GROUP_LABEL : `Wave ${(wave.discoveryIndex ?? 0) + 1}`;
}

/** The small pill on a discovery card. Relationship cards carry
 *  "Invited"/"Referred by X" instead and must never get a wave badge. */
export function waveCardBadge(wave: Pick<PipelineWave<unknown>, 'kind' | 'discoveryIndex'>): string | null {
  return wave.kind === 'relationships' ? null : `W${(wave.discoveryIndex ?? 0) + 1}`;
}
