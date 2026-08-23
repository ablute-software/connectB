// Shared round-progress percentage math. Extracted out of
// src/app/portal/page.tsx's own inline calculation (the investor dossier's
// progress bar) so Prompt 322's round-milestone broadcast can produce the
// EXACT SAME number rather than a second, drift-prone reimplementation —
// "reutiliza esse cálculo, não reimplementes" was the prompt's own explicit
// instruction. securedShown is the founder's own round_secured_eur PLUS any
// investor_soft_commits confirmed_by_founder=true (see /api/portal/access's
// own header comment for why soft commits add on top rather than overwrite).
export function computeRoundProgressPercent(securedShown: number | null | undefined, targetEur: number | null | undefined): number | null {
  if (targetEur == null || targetEur <= 0 || securedShown == null) return null;
  return Math.min(100, Math.round((securedShown / targetEur) * 100));
}
