// Prompt 428 §E — Berkus Method pure math. Same discipline as cap-table.ts/
// rules.ts: logic lives here, tested, never inline in the component.
//
// Phase 1 (this file, per the prompt's own 415-style phasing note): the
// level<->EUR math both modes share. Phase 2 (Detailed) adds
// berkusApplicability/berkusDiagnostic/berkusSensitivity here, once
// Detailed mode's UI actually calls them — not written ahead of that call
// site.
import { BERKUS_SIMPLIFIED_ANCHORS, BERKUS_DETAILED_LEVEL_PCT, type BerkusFactorKey } from '@/content/berkus/factors_v1';

export type BerkusMode = 'simplified' | 'detailed';

export const BERKUS_DEFAULT_CALIBRATION_REF_EUR = 500000;

// §C — the UI must label the result "Investor-calibrated Berkus" whenever
// the reference differs from the classic €500k default; never plain
// "Berkus estimate" once calibrated (docx §4).
export function isInvestorCalibrated(refEur: number): boolean {
  return refEur !== BERKUS_DEFAULT_CALIBRATION_REF_EUR;
}

// level=null (not yet answered) or skipped=true both contribute 0% — never
// a fabricated partial value for an unanswered/skipped factor. Each mode
// uses its OWN level->% table on purpose (Prompt 428's own instruction —
// see factors_v1.ts's header); never unify them.
export function berkusLevelPct(mode: BerkusMode, level: number | null, skipped: boolean): number {
  if (level == null || skipped) return 0;
  if (mode === 'simplified') return BERKUS_SIMPLIFIED_ANCHORS.find((a) => a.level === level)?.pct ?? 0;
  return BERKUS_DETAILED_LEVEL_PCT[level as 0 | 1 | 2 | 3 | 4 | 5] ?? 0;
}

export function berkusFactorEur(mode: BerkusMode, level: number | null, skipped: boolean, refEur: number): number {
  return Math.round((berkusLevelPct(mode, level, skipped) / 100) * refEur);
}

export interface BerkusFactorLevel { key: BerkusFactorKey; level: number | null; skipped: boolean }

// §C — recalibrating changes refEur only; every factor's illustrative EUR
// (and so the total) recomputes proportionally from the SAME levels —
// nothing about what the investor already judged ever changes.
export function berkusTotalEur(mode: BerkusMode, factors: BerkusFactorLevel[], refEur: number): number {
  return factors.reduce((sum, f) => sum + berkusFactorEur(mode, f.level, f.skipped, refEur), 0);
}
