// Prompt 893 §F.3 — "fit sem tese não é Medium." The Insight Venture
// audit (see DECISIONS.md, Prompt 893) found entity.fit_score itself is
// null for that investor — no static badge could have rendered "Medium
// fit" for it via entity.fit_score today. This helper still closes the
// underlying rule the spec asks for: whenever a firm has neither a thesis
// nor any sectors on file, ANY fit label — however it got set — is
// unsupported and must say so honestly instead of implying a real
// assessment happened. Scoped to the founder-facing dossier's own fit
// pill (EntityDossierPanel.tsx, entities/[id]/page.tsx) — not to the
// broader FitTag/fitLabel used across Pipeline/investor-workspace, which
// is a materially larger blast radius the audit deliberately did not
// widen into (see the delivery report).
import type { Entity, FitScore } from './types';

const FIT_LABEL: Record<FitScore, string> = { high: 'High', medium_high: 'Med-High', medium: 'Medium', low: 'Low' };

export function hasThesisOrSectors(entity: Pick<Entity, 'thesis' | 'sectors'>): boolean {
  return !!(entity.thesis && entity.thesis.trim()) || (entity.sectors?.length ?? 0) > 0;
}

export function effectiveFitLabel(entity: Pick<Entity, 'thesis' | 'sectors' | 'fit_score'>): string | null {
  if (!hasThesisOrSectors(entity)) return 'Fit unknown — thesis missing';
  if (!entity.fit_score) return null;
  return `${FIT_LABEL[entity.fit_score]} fit`;
}
