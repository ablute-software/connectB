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

export function FrostedOverlay({ message, ctaLabel = 'Create your free investor account', source, children }: {
  /** The one contextual sentence explaining what signing up unlocks here. */
  message: string;
  ctaLabel?: string;
  /** Where this visitor came from, preserved through signup. */
  source: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div aria-hidden="true" className="pointer-events-none select-none blur-[3px] opacity-60">
        {children}
      </div>

      {/* The gate itself. Sits above the blurred preview, is the only part of
          this area that accepts a click, and always offers a way forward. */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="max-w-sm rounded-2xl border border-gray-200 bg-white/90 p-6 text-center shadow-xl backdrop-blur-sm">
          <p className="text-sm text-gray-700">{message}</p>
          {/* Prompt 526 §B — the EXISTING signup flow, unchanged (today a
              reviewed lead form). `source` is carried so a future self-serve
              signup can return the investor to the tool they clicked instead of
              a generic dashboard; nothing here depends on that working yet, the
              point is not to throw the information away. */}
          <Link href={`/signup?as=investor&source=${encodeURIComponent(source)}`}
            className="mt-4 inline-block rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b]">
            {ctaLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
