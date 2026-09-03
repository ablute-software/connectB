// Prompt 544 Part D — the line under an entity's name in the Pipeline.
//
// The founder's complaint was "não se sabe quem contactar, como". The row
// showed a name, a fit badge and a wave; everything that would answer either
// question sat in catalog_people one join away. This turns that into chips
// the founder reads before opening anything.
//
// Pure so the wording and the grey/normal decision are testable without a
// database or a render.

export interface ReadinessBreakdown {
  peopleCount: number;
  linkedinCount: number;
  hookCount: number;
  hasForm: boolean;
  hasEmail: boolean;
}

export interface ReadinessChip {
  label: string;
  /** True when the number is zero — rendered grey, not hidden. */
  muted: boolean;
}

/**
 * The chips, in the order the founder needs them: who, how reachable, then
 * the channels, then whether Sherlock has done the research yet.
 *
 * Zeros are SHOWN, greyed — never omitted. "0 hooks" is the single most
 * useful thing on this line: it is why preflight will refuse the draft, and
 * hiding it would leave the founder to discover that at the compose step.
 */
export function readinessChips(b: ReadinessBreakdown): ReadinessChip[] {
  const chips: ReadinessChip[] = [
    { label: `${b.peopleCount} ${b.peopleCount === 1 ? 'person' : 'people'}`, muted: b.peopleCount === 0 },
    { label: `${b.linkedinCount} on LinkedIn`, muted: b.linkedinCount === 0 },
  ];
  if (b.hasForm) chips.push({ label: 'form ✓', muted: false });
  if (b.hasEmail) chips.push({ label: 'email ✓', muted: false });
  chips.push({ label: `${b.hookCount} ${b.hookCount === 1 ? 'hook' : 'hooks'}`, muted: b.hookCount === 0 });
  return chips;
}

/** Nothing at all to say — the strip is hidden rather than showing five zeros. */
export function hasAnythingToShow(b: ReadinessBreakdown): boolean {
  return b.peopleCount > 0 || b.hasForm || b.hasEmail;
}
