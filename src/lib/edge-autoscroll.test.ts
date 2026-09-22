import { describe, expect, it } from 'vitest';
import { autoScrollDelta } from './edge-autoscroll';

// Prompt 704 (18/09/2026) — the math behind "drag a row near the top or
// bottom of the screen and the page follows it." autoScroll itself touches
// the DOM (elementFromPoint, scrollTop) and isn't tested here, same split as
// every other pure-decision module in this codebase.

describe('autoScrollDelta', () => {
  const VH = 800;

  it('is zero in the middle of the viewport — no edge, no scroll', () => {
    expect(autoScrollDelta(400, VH)).toBe(0);
  });

  it('is zero exactly at the edge threshold, both sides', () => {
    expect(autoScrollDelta(72, VH, 72, 16)).toBe(0);
    expect(autoScrollDelta(VH - 72, VH, 72, 16)).toBe(0);
  });

  it('scrolls up (negative) the closer the pointer gets to the top', () => {
    expect(autoScrollDelta(36, VH, 72, 16)).toBe(-8);
    expect(autoScrollDelta(0, VH, 72, 16)).toBe(-16);
  });

  it('scrolls down (positive) the closer the pointer gets to the bottom', () => {
    expect(autoScrollDelta(VH - 36, VH, 72, 16)).toBe(8);
    expect(autoScrollDelta(VH, VH, 72, 16)).toBe(16);
  });

  it('never scrolls both ways at once on a viewport shorter than twice the edge zone', () => {
    // A pointer dead center of a very short viewport is still outside both
    // edge zones as long as the viewport is taller than 2×edgePx.
    expect(autoScrollDelta(75, 150, 72, 16)).toBe(0);
  });
});
