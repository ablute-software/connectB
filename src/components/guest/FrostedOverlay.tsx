'use client';
// Prompt 526 Part B — the frosted-glass technique, generalised.
//
// It existed only inside /guest/[token]/page.tsx's FrostedSidebar: blur +
// opacity + pointer-events-none over decorative content. The email's three
// new CTAs need the same treatment over three different screens, so it lives
// here now rather than being copied three more times.
//
// TWO SEPARATE JOBS, deliberately not merged into one component:
//   FrostedContent — makes its children unreadable-but-suggestive. Used for
//     the fake rows/cards behind the glass.
//   FrostedOverlay — the message and CTA that sit ON TOP, in full focus.
// Keeping them apart is what lets the CTA stay clickable while everything
// beneath it is inert: a single component would have to either blur its own
// call to action or leak pointer events into the content it is covering.
import Link from 'next/link';

/** Decorative, unreadable content. Never render anything real inside this. */
export function FrostedContent({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    // aria-hidden as well as pointer-events-none: a screen reader must not
    // read out placeholder rows as if they were data, and nothing in here is
    // reachable by keyboard either.
    <div aria-hidden className={`pointer-events-none select-none opacity-50 blur-[2px] ${className}`}>
      {children}
    </div>
  );
}

export function FrostedOverlay({ title, message, ctaLabel = 'Sign up', ctaHref }: {
  title: string;
  message: string;
  ctaLabel?: string;
  /** Where "Sign up" goes — always the existing signup flow, never a new one. */
  ctaHref: string;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center px-6">
      {/* The scrim is what turns "blurry content" into "deliberately locked":
          without it the blur reads as a rendering bug rather than a gate. */}
      <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px]" />
      <div className="relative max-w-md rounded-2xl border border-gray-200 bg-white/95 p-6 text-center shadow-lg">
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">{message}</p>
        <Link href={ctaHref}
          className="mt-4 inline-block rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0c637b]">
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}

/**
 * Placeholder fill for the frosted screens. Deliberately a grey bar and never
 * invented company names, numbers or scores: Prompt 526 Part B requires that
 * none of the three previews expose real startup data, and the cheapest way
 * to guarantee that is for there to be no content to expose — not even
 * plausible-looking fiction a guest could mistake for a real match. It is the
 * same idiom PipelinePanel's own LockedWave already uses for a locked wave.
 */
export function SkeletonBar({ className = '' }: { className?: string }) {
  return <div className={`rounded bg-gray-300 ${className}`} />;
}
