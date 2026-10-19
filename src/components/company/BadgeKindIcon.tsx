// Prompt 918 C.4 — the icon a badge shows when it has no logo (no upload, none found): one per kind, drawn inline so it needs no file
// and no network, and never initials in a circle. Decorative (the name is always written next to it).
import type { BadgeKind } from '@/lib/company-badges';

const PATHS: Record<BadgeKind, JSX.Element> = {
  // trophy
  award: (
    <>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
    </>
  ),
  // seal with a tick
  certification: (
    <>
      <circle cx="12" cy="10" r="6" />
      <path d="m9.5 10 1.8 1.8 3.2-3.6" />
      <path d="M8.5 15 7 21l5-2.5L17 21l-1.5-6" />
    </>
  ),
  // graduation cap
  programme: (
    <>
      <path d="M2 9l10-5 10 5-10 5L2 9Z" />
      <path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5" />
      <path d="M22 9v6" />
    </>
  ),
  // star
  recognition: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />,
};

export function BadgeKindIcon({ kind, className = 'h-6 w-6' }: { kind: BadgeKind; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true" data-badge-kind-icon={kind}>
      {PATHS[kind]}
    </svg>
  );
}
