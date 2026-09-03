// Prompt 526 Part B — the frosted-glass gate, generalised.
//
// The technique already existed but only as markup baked into /guest/[token]'s
// own decorative sidebar (blur + opacity + pointer-events-none). The three
// preview pages need the same treatment over a whole content area, so it lives
// here as one component instead of being copied three more times.
//
// What it guarantees, and why it is safe: the children it blurs are placeholder
// content with no real startup data behind them, and the blur is NOT the
// security boundary — there is nothing underneath worth protecting. The overlay
// is a product gesture ("this is what the tool looks like; sign up to use it"),
// which is exactly why it can be purely visual. `pointer-events-none` on the
// blurred layer stops the preview from feeling like a broken app the visitor
// can half-click.
import Link from 'next/link';
import { FrostedGate } from '@/components/workspace-shell/FrostedGate';

export function FrostedOverlay({ message, ctaLabel = 'Create your free investor account', signupHref, children }: {
  /** The one contextual sentence explaining what signing up unlocks here. */
  message: string;
  ctaLabel?: string;
  // Prompt 548 — the whole href, built by previewSignupHref, rather than a
  // bare `source` this component then had to assemble. It now also carries
  // the guest token when there is one, and that belongs in one place.
  signupHref: string;
  children: React.ReactNode;
}) {
  // Prompt 554 — the gate itself: above the blurred preview, the only part
  // of this area that accepts a click, and always offering a way forward.
  // Now via FrostedGate, so on a guest preview taller than the viewport the
  // card follows the reader instead of hiding in the block's middle. The
  // card's own styling (border, shadow, /90 tint) is unchanged; the overlay
  // is transparent here because the CARD carries the frosting.
  return (
    <FrostedGate
      locked
      blur="blur-[3px]"
      blurClassName="opacity-60"
      overlayClassName="bg-transparent backdrop-blur-none p-4"
      message={(
        <div className="max-w-sm rounded-2xl border border-gray-200 bg-white/90 p-6 text-center shadow-xl backdrop-blur-sm">
          <p className="text-sm text-gray-700">{message}</p>
          {/* Prompt 526 §B — the EXISTING signup flow, unchanged (today a
              reviewed lead form). `source` is carried so a future self-serve
              signup can return the investor to the tool they clicked instead of
              a generic dashboard; nothing here depends on that working yet, the
              point is not to throw the information away. */}
          <Link href={signupHref}
            className="mt-4 inline-block rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b]">
            {ctaLabel}
          </Link>
        </div>
      )}
    >
      {children}
    </FrostedGate>
  );
}
