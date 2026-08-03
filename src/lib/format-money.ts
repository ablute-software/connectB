// P106 §3 — split out from components/ui.tsx (JSX) so this pure function
// can actually be unit-tested: vitest here has no React/JSX plugin wired
// up, so a .test.ts importing a .tsx file fails to parse. Every other
// formatter in ui.tsx has the same limitation; this one just needed real
// test coverage per the prompt.
//
// Dedicated to Round Progress (dashboard/OverviewPanel.tsx,
// today/TodayPanel.tsx) only — ui.tsx's own fmtEur() abbreviates
// everything below €1M to "k" and rounds >€1M to 1 decimal, which is wrong
// for these two cards: they need the full number spelled out below €1M
// and up to 2 decimals above it. Not a replacement for fmtEur() — that's
// used all over the app (ticket sizes, check sizes) where the "k"
// abbreviation is wanted.
//
// Below-€1M formatting uses a thousands separator (€500,000) — the
// prompt's own example text had none (€500000); this was flagged back as
// an open question and defaulted to the standard convention pending
// confirmation.
export function fmtRoundEur(n?: number): string {
  if (n == null) return '—';
  const trim = (v: number) => (Math.round(v * 100) / 100).toString();
  if (Math.abs(n) >= 1_000_000_000) return `€${trim(n / 1_000_000_000)}B`;
  if (Math.abs(n) >= 1_000_000) return `€${trim(n / 1_000_000)}M`;
  return `€${n.toLocaleString('en-US')}`;
}
