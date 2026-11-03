// Prompt 935 (02/11/2026) — the pure rules behind the fixed landing (one screen: a photograph, a wheel of sections at the height of the photograph's magnifying glass, a glass card under it). Kept out of the
// components so the geometry is pinned without a browser, and so the stylesheet's `calc()` formulas have ONE reference to be checked against.
//
// The mockup (v21) computes the lens in JavaScript once the photograph has loaded (`lens()`): where the photograph sits, how big it is drawn, how big the wheel's discs are. Here the same numbers are written
// as CSS `calc()` on `dvh`/`vw` (landing-fixed.module.css), so the first paint is already right, nothing waits for an image and nothing moves afterwards (CLS 0). `lensLayout` is the JavaScript form of the
// same formulas: the test compares it with the mockup's numbers at several window sizes, and with the CSS formulas by evaluating them.

/** The photograph (public/landing/lens-photo.*): 1045 x 1084 px; the lens in it, measured from the file. */
export const PHOTO = { width: 1045, height: 1084, lensX: 0.504, lensY: 0.461, lensD: 0.102 } as const;

/** Where the lens must sit on the screen and how big it is: 46% down and 18% of the window's height across (Nuno's brief; the position was right, 03/11/2026: left alone). */
export const SCREEN_LENS = { y: 0.46, d: 0.18 } as const;

/** The wheel's discs: a disc is 39% of the lens, between 40 and 80 px; the gap between discs is 37% of a disc. */
export const WHEEL = { discRatio: 0.39, discMin: 40, discMax: 80, gapRatio: 0.37 } as const;

export interface LensLayout {
  /** The lens, in px of the window. */
  lx: number; ly: number; ld: number;
  /** The photograph as drawn: size and top-left corner. */
  photoW: number; photoH: number; photoLeft: number; photoTop: number;
  /** A wheel disc, the gap between two discs, the distance from the lens' centre to the first disc's centre and from one disc's centre to the next's. */
  d: number; gap: number; first: number; step: number;
}

/** The mockup's `lens()`, for a window of `vw` x `vh` px. */
export function lensLayout(vw: number, vh: number): LensLayout {
  const ld = SCREEN_LENS.d * vh;
  const scale = ld / (PHOTO.lensD * PHOTO.width);
  const photoW = PHOTO.width * scale;
  const photoH = PHOTO.height * scale;
  const lx = vw / 2;
  const ly = SCREEN_LENS.y * vh;
  const d = Math.max(WHEEL.discMin, Math.min(ld * WHEEL.discRatio, WHEEL.discMax));
  const gap = d * WHEEL.gapRatio;
  return { lx, ly, ld, photoW, photoH, photoLeft: lx - PHOTO.lensX * photoW, photoTop: ly - PHOTO.lensY * photoH, d, gap, first: ld / 2 + gap + d / 2, step: d + gap };
}

/** The signed distance, in places, from the selected place `cur` to place `i` on a ring of `n` places: -n/2..n/2, 0 for the selected one. */
export function ringOffset(i: number, cur: number, n: number): number {
  let o = (((i - cur) % n) + n) % n;
  if (o > n / 2) o -= n;
  return o;
}

/** Where a place `offset` places from the selected one sits, in px from the lens' centre (negative = left). 0 is the lens itself. */
export function wheelX(offset: number, l: Pick<LensLayout, 'first' | 'step'>): number {
  if (offset === 0) return 0;
  return Math.sign(offset) * (l.first + (Math.abs(offset) - 1) * l.step);
}

/** A place that goes round the back of the ring (from one side to the other) must not slide across the screen: it is moved, hidden, and shown again. True when it has. */
export function jumped(prevOffset: number, offset: number, n: number): boolean {
  return Math.abs(prevOffset - offset) > n / 2;
}

/** The index after a step of `dir` (+1 / -1) on a ring of `n` places. */
export function stepIndex(cur: number, dir: 1 | -1, n: number): number {
  return (((cur + dir) % n) + n) % n;
}

/** The wheel, the arrow keys and the touch swipe may not step faster than once every 520 ms (a mouse wheel sends dozens of events for one flick). */
export const STEP_LOCK_MS = 520;
export function stepAllowed(lastStepAt: number, now: number): boolean {
  return now - lastStepAt >= STEP_LOCK_MS;
}

/** A vertical wheel flick under 8 px is noise; a horizontal swipe needs 40 px and a vertical one 50. */
export const WHEEL_MIN_DELTA = 8;
export const SWIPE_MIN_X = 40;
export const SWIPE_MIN_Y = 50;

/** What a touch gesture means: -1 / +1 to step, 0 for nothing. `startedInCard`: the finger began inside the card, where a vertical drag scrolls the card instead. */
export function swipeStep(dx: number, dy: number, startedInCard: boolean): -1 | 0 | 1 {
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_MIN_X) return dx < 0 ? 1 : -1;
  if (Math.abs(dy) > SWIPE_MIN_Y && !startedInCard) return dy < 0 ? 1 : -1;
  return 0;
}

/**
 * A wheel event over the card: the card scrolls while it can; only when it is at its end (or has nothing to scroll) does the wheel turn the ring.
 * `scrollTop`, `clientHeight`, `scrollHeight` are the card body's; `deltaY` the event's.
 */
export function cardCanScroll(deltaY: number, scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return deltaY > 0 ? scrollTop + clientHeight < scrollHeight - 1 : scrollTop > 0;
}

/** "See all" is offered only when the section does not fit (or the card is already raised). */
export function hasMore(scrollHeight: number, clientHeight: number, open: boolean): boolean {
  return open || scrollHeight > clientHeight + 4;
}

/** The heading's rotation: every 6 s, fading out over ~0.9 s, the text changing under the fog. */
export const LINE_EVERY_MS = 6000;
export const LINE_FOG_MS = 950;
export function nextLine(current: number, count: number): number {
  return (current + 1) % count;
}
