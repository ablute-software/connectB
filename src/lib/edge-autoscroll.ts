// Prompt 704 (18/09/2026) — auto-scroll while dragging a Pipeline row near
// the top or bottom of the screen. Nuno's report: dragging a row up toward
// the header did nothing, so the state cards it needs to land on (now real
// drop targets, Phase 4 — see pipeline-drop.ts) went off-screen above the
// fold and stayed there for the rest of the drag.
//
// The math (how far, which way) is pure and unit-tested; actually moving a
// scrollbar needs the DOM, so that half isn't — same split this file's
// caller (usePipelineRowDrag.ts) already uses for the drag gesture itself.

const EDGE_PX = 72;
const MAX_PX_PER_FRAME = 16;

/**
 * How far to scroll this animation frame, and which way, given the
 * pointer's distance from the top/bottom of the viewport. Zero outside the
 * edge zone; scales linearly up to maxPxPerFrame right at the edge.
 * Negative = scroll up (pointer near the top), positive = scroll down.
 */
export function autoScrollDelta(
  pointerY: number, viewportHeight: number, edgePx = EDGE_PX, maxPxPerFrame = MAX_PX_PER_FRAME,
): number {
  if (pointerY < edgePx) return -Math.ceil(((edgePx - pointerY) / edgePx) * maxPxPerFrame);
  const fromBottom = viewportHeight - pointerY;
  if (fromBottom < edgePx) return Math.ceil(((edgePx - fromBottom) / edgePx) * maxPxPerFrame);
  return 0;
}

/**
 * The nearest scrollable ancestor of `el` (including a capped list like the
 * Pipeline table's own max-h-[75vh], Prompt 529) that still has room to move
 * in `dy`'s direction, or the page's own scrolling element if none does —
 * so scrolling always bubbles up to the funnel cards once an inner list
 * bottoms/tops out, instead of getting stuck against it.
 */
function scrollTargetFor(el: Element | null, dy: number): Element {
  let node: HTMLElement | null = el as HTMLElement | null;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      const canScrollUp = node.scrollTop > 0;
      const canScrollDown = node.scrollTop + node.clientHeight < node.scrollHeight;
      if ((dy < 0 && canScrollUp) || (dy > 0 && canScrollDown)) return node;
    }
    node = node.parentElement;
  }
  return document.scrollingElement ?? document.documentElement;
}

/** Scroll whatever's actually scrollable under (x, y) by dy. No-ops at dy === 0 so a caller can call this unconditionally every frame. */
export function autoScroll(x: number, y: number, dy: number): void {
  if (dy === 0) return;
  const target = scrollTargetFor(document.elementFromPoint(x, y), dy);
  target.scrollTop += dy;
}
