// The Sherlock Deal mark: a teal badge carrying a serif "S" with a magnifying
// lens over its shoulder. Extracted from the approved landing design so the
// nav, the footer and the favicon (src/app/icon.svg) all come from one shape.
// Pure presentational SVG — safe in server components.
import { BRAND_WORDMARK } from '@/lib/brand';

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="11" fill="#2a7f8e" />
      <text x="10" y="37" fontFamily="Georgia,'Times New Roman',serif" fontSize="31" fontWeight="700" fill="#fff">S</text>
      <circle cx="35.5" cy="15" r="7" fill="none" stroke="#fff" strokeWidth="2.9" />
      <line x1="40.5" y1="20" x2="44.5" y2="24" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

// Badge + wordmark lockup. The accent half of the wordmark ("deal") is coloured
// by the caller's CSS via `accentClassName`, so the same lockup works on the
// dark hero nav (amber) and the light footer (teal).
export function LogoLockup({ size = 32, accentClassName }: { size?: number; accentClassName?: string }) {
  const [primary, accent] = BRAND_WORDMARK;
  return (
    <>
      <LogoMark size={size} />
      <span>
        {primary}
        <span className={accentClassName}>{accent}</span>
      </span>
    </>
  );
}
