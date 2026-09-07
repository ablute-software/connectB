// Prompt 605 §D — one click that photographs the page the user is looking
// at, without the widget standing in front of it.
//
// WHY html2canvas-pro AND NOT html2canvas (605 §D.1, answered by 607 §A).
// The app's sidebar palette is eleven OKLCH tokens (globals.css, --sb-*).
// html2canvas@1.4.1 does not merely get those colours wrong: it THROWS
// ("Attempting to parse an unsupported color function \"oklch\"") and
// returns no image at all — measured on a real /backoffice screen on
// 2026-09-07, which is why nothing was built on top of it. html2canvas-pro
// (a maintained fork; the same two transitive deps, both by html2canvas's
// own author) converts oklch/oklab/lab/lch through XYZ to sRGB. Measured on
// the same screen: all eleven tokens captured byte-identical to the
// browser's own conversion, max channel delta 0.
//
// PINNED EXACTLY, and to 2.4.1 rather than the 2.4.2 that was current on
// the day (607 §A.1 — "É supply chain a entrar numa app que lê documentos
// confidenciais"). 2.4.2 had been published that same morning; 2.4.1 had six
// days behind it. Bump deliberately, never by a caret.
//
// IF THE FORK EVER DISAPPOINTS US, the exit is NOT a DOM pre-pass rewriting
// colours before each capture (607 §A.3, and it is a worse idea than it
// looks: colours also live inside box-shadow, gradients, outline and SVG
// fill/stroke, so that is a CSS parser running over the live DOM, with
// guaranteed restoration even when the capture throws). The exit is to
// convert the tokens to rgb() at BUILD time in globals.css, keeping OKLCH as
// the authoring format — one pass over one stylesheet, not one pass over
// every capture.

/** Elements matching these are hidden for the duration of the capture. */
export interface CaptureOptions {
  /** Selectors to hide — §D: "esconder o widget → esperar um frame →
   *  capturar → repor o widget". */
  hide?: string[];
  /** Cap on the longest edge of the produced PNG. A 4K viewport otherwise
   *  makes an 8MB attachment out of a screenshot nobody needs at that size,
   *  and the upload route's own cap is 10MB. */
  maxEdge?: number;
}

export interface CaptureResult {
  blob: Blob;
  /** Object URL for the preview (§D.2). The caller revokes it. */
  previewUrl: string;
  width: number;
  height: number;
}

const DEFAULT_MAX_EDGE = 1800;
// Generous next to a 16ms frame, short next to a person waiting for a button.
const FRAME_TIMEOUT_MS = 250;

/** Resolves on the next painted frame, or after `ms` if frames aren't running. */
function frameOrTimeout(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const timer = setTimeout(done, ms);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); done(); }));
  });
}

/**
 * Captures the current viewport to a PNG blob.
 *
 * Restoration of the hidden elements is in a `finally`, so a capture that
 * throws half-way cannot leave the user staring at a page with its own
 * widget missing.
 */
export async function captureViewport(options: CaptureOptions = {}): Promise<CaptureResult> {
  const { hide = [], maxEdge = DEFAULT_MAX_EDGE } = options;

  const hidden: { el: HTMLElement; previous: string }[] = [];
  for (const selector of hide) {
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      hidden.push({ el, previous: el.style.visibility });
      // visibility, not display: hiding by display reflows the page, so the
      // photograph would not be of the page the user was looking at.
      el.style.visibility = 'hidden';
    });
  }

  try {
    // One frame for the style change to be painted before we read the DOM —
    // but NEVER on requestAnimationFrame alone. A browser does not run rAF
    // callbacks in a hidden or backgrounded tab, so a bare
    // `await new Promise(r => requestAnimationFrame(r))` hangs there forever
    // with no error and no rejection: the button just says "Taking the shot…"
    // until the page is reloaded. Found the hard way while verifying this
    // module in a hidden browser pane on 2026-09-07 — two nested rAF calls,
    // no image, no exception, nothing in the console. Racing a timer means
    // the worst case is a capture taken a tick early rather than no capture
    // at all and a control stuck mid-sentence.
    await frameOrTimeout(FRAME_TIMEOUT_MS);

    const { default: html2canvas } = await import('html2canvas-pro');
    const source = await html2canvas(document.body, {
      backgroundColor: null,
      scale: 1,
      logging: false,
      useCORS: true,
      // The viewport only. Capturing the whole scroll height would send a
      // document the user never saw in one frame, which is the opposite of
      // what §D.3's consent argument assumes they are agreeing to.
      width: window.innerWidth,
      height: window.innerHeight,
      x: window.scrollX,
      y: window.scrollY,
      scrollX: -window.scrollX,
      scrollY: -window.scrollY,
    });

    const canvas = downscale(source, maxEdge);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The screenshot could not be encoded.');
    return { blob, previewUrl: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
  } finally {
    for (const { el, previous } of hidden) el.style.visibility = previous;
  }
}

function downscale(source: HTMLCanvasElement, maxEdge: number): HTMLCanvasElement {
  const longest = Math.max(source.width, source.height);
  if (longest <= maxEdge) return source;
  const ratio = maxEdge / longest;
  const out = document.createElement('canvas');
  out.width = Math.round(source.width * ratio);
  out.height = Math.round(source.height * ratio);
  const ctx = out.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

/** The file name the attachment arrives with in the back-office. */
export function screenshotFileName(now = new Date()): string {
  return `screenshot-${now.toISOString().replace(/[:.]/g, '-')}.png`;
}
