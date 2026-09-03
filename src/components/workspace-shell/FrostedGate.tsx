// Prompt 554 — a locked block's explanation follows the viewport, never the
// block's own middle.
//
// THE BUG. Every gate in this app was `absolute inset-0 flex items-center
// justify-center`, which centres the message in the BLOCK. For a block
// shorter than the viewport those coincide and it looks right; for a tall
// one — Readiness & Train's seven tabs are two or three screens — the
// message sits a screen and a half down. A free-plan founder arriving at
// Review saw frosted cards and nothing else. The only text explaining WHY
// was off-screen, and a first-run founder does not know to scroll to find
// out why the product is greyed out.
//
// THE FIX is `position: sticky` on the message box inside the overlay, not
// flex-centring of the overlay. Why sticky and not the obvious
// alternatives:
//   - `fixed` would escape the block entirely and float over the header and
//     sidebar once the founder scrolled past the gate.
//   - An IntersectionObserver or a scroll listener would reimplement, in
//     JavaScript and on every frame, what the compositor already does.
// Sticky inside an absolutely-positioned box is legal and is exactly the
// behaviour wanted here: the scrollport is the page, but the containing
// block is the overlay, so the message can never leave the frosted area. It
// rides down with the page while the block is on screen and leaves with the
// block when it scrolls past.
//
// ONE PRECONDITION, and it fails silently if it breaks: no ancestor between
// this gate and the page scrollport may have `overflow: hidden|auto`, or the
// nearest scrollport becomes that ancestor and stickiness quietly dies.
// Verified today — `grep -rn "overflow-hidden\|overflow-y-auto"` over
// shell.tsx and InvestorWorkspaceShell.tsx returns nothing — and pinned by
// FrostedGate.test.ts so a future layout change trips a test instead of
// silently re-hiding the message.
import type { ReactNode } from 'react';

// The message starts a little below the block's top on first paint rather
// than glued to it, so on a SHORT block it lands where the old flex-centred
// version did and nothing regresses. min() keeps it sane on a short
// viewport.
export const GATE_TOP_PADDING = 'pt-[min(20vh,160px)]';
// Half the viewport, less roughly half the message box — so the box sits
// centred rather than starting at the midpoint.
export const GATE_STICKY_TOP = 'sticky top-[calc(50vh-48px)]';

export function FrostedGate({ locked, message, note, cta, className, overlayClassName, blurClassName, blur = 'blur-[2px]', children }: {
  locked: boolean;
  /** The headline — a pill, a lock glyph, whatever the call site already had. */
  message: ReactNode;
  /** Secondary line or list under it. */
  note?: ReactNode;
  /** The way forward. A locked block should always offer one. */
  cta?: ReactNode;
  /** Extra classes for the relative wrapper. */
  className?: string;
  /** Extra classes for the overlay itself — call sites differ in tint and radius. */
  overlayClassName?: string;
  /** Extra classes for the blurred content wrapper (spacing, opacity). */
  blurClassName?: string;
  /** The blur utility itself. A prop, not something blurClassName can append
   *  to: two Tailwind blur classes on one element resolve by stylesheet
   *  order, not attribute order, so "blur-[2px] blur-[3px]" is a coin flip.
   *  The guest previews genuinely use 3px and must keep it. */
  blur?: string;
  children: ReactNode;
}) {
  return (
    <div className={`relative${className ? ` ${className}` : ''}`}>
      {/* aria-hidden while locked: a screen reader must not read out content
          the founder cannot reach, and the blur is not a security boundary —
          the overlay swallowing pointer events is what stops interaction. */}
      <div
        aria-hidden={locked || undefined}
        className={locked
          ? `pointer-events-none select-none ${blur}${blurClassName ? ` ${blurClassName}` : ''}`
          : (blurClassName ?? undefined)}
      >
        {children}
      </div>

      {locked && (
        // No flex centring here — that is the bug. The overlay covers the
        // whole block; the sticky child decides where the message sits.
        <div className={`absolute inset-0 z-10 rounded-2xl bg-white/55 backdrop-blur-[3px] ${GATE_TOP_PADDING}${overlayClassName ? ` ${overlayClassName}` : ''}`}>
          <div className={`${GATE_STICKY_TOP} mx-auto flex max-w-sm flex-col items-center gap-2 px-4 text-center`}>
            {message}
            {note}
            {cta}
          </div>
        </div>
      )}
    </div>
  );
}
