// Prompt 428 §E — Berkus Method pure math. Same discipline as cap-table.ts/
// rules.ts: logic lives here, tested, never inline in the component.
//
// Phase 1: the level<->EUR math both modes share. Phase 2 (this addition):
// applicability, diagnostic and sensitivity — Detailed-only, per §F ("sem
// diagnóstico dedicado nem sensibilidade" for Simplified). No string
// formatting in here (no Intl.NumberFormat) — same split as cap-table.ts,
// which never formats either; the component's own fmtEur builds display
// strings from these functions' plain numbers.
import { BERKUS_SIMPLIFIED_ANCHORS, BERKUS_DETAILED_LEVEL_PCT, type BerkusFactorKey } from '@/content/berkus/factors_v1';
import type { CompanyPhase } from './types';

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

export interface BerkusApplicability { applicable: boolean; reason: string }

// §B — Berkus is a PRE-REVENUE valuation method; once a company has real
// market traction, the txt's own Factor E note says it starts losing
// relevance relative to revenue-based methods. Informational only — per
// §B's own explicit instruction, this NEVER blocks the investor from
// using Berkus anyway.
const BERKUS_LOW_RELEVANCE_PHASES: CompanyPhase[] = ['launch_early_adopters', 'growth'];

export function berkusApplicability(companyPhase: CompanyPhase): BerkusApplicability {
  if (BERKUS_LOW_RELEVANCE_PHASES.includes(companyPhase)) {
    return {
      applicable: false,
      reason: 'This company already shows real market traction — Berkus is a pre-revenue method and may be losing relevance here relative to revenue-based valuation approaches.',
    };
  }
  return { applicable: true, reason: 'This company is still pre-revenue or early-traction — Berkus’ risk-reduction framing fits well at this stage.' };
}

export interface BerkusDiagnostic {
  strongest: BerkusFactorKey | null; // highest EUR contribution among ANSWERED factors — "Strongest de-risking contributor"
  weakest: BerkusFactorKey | null; // lowest EUR contribution among ANSWERED factors — "Largest remaining risk"
  criticalUnknown: BerkusFactorKey | null; // the investor's own skip, or by omission the least-covered factor
}

// §E Step 5 (Diagnostic). strongest/weakest are scoped to ALREADY-ANSWERED
// factors only (the prompt's own wording: "entre os fatores já
// respondidos") — an unanswered factor never wins or loses that
// comparison, it's what criticalUnknown is for instead. A factor the
// investor explicitly skipped (a deliberate "not enough evidence" signal)
// takes priority over a merely-unanswered one for criticalUnknown; ties
// resolve to the first factor in BERKUS_FACTORS_V1's own declared order.
export function berkusDiagnostic(mode: BerkusMode, factors: BerkusFactorLevel[], refEur: number): BerkusDiagnostic {
  const answered = factors.filter((f) => f.level != null && !f.skipped);
  const withEur = answered.map((f) => ({ key: f.key, eur: berkusFactorEur(mode, f.level, f.skipped, refEur) }));
  const strongest = withEur.length > 0 ? withEur.reduce((a, b) => (b.eur > a.eur ? b : a)).key : null;
  const weakest = withEur.length > 0 ? withEur.reduce((a, b) => (b.eur < a.eur ? b : a)).key : null;
  const skipped = factors.find((f) => f.skipped);
  const unanswered = factors.find((f) => f.level == null && !f.skipped);
  return { strongest, weakest, criticalUnknown: skipped?.key ?? unanswered?.key ?? null };
}

export interface BerkusSensitivity { factor: BerkusFactorKey; fromLevel: number; toLevel: number; deltaEur: number }

// §E Step 6 (Sensitivity) — "what would most change this valuation": the
// answered, non-skipped, not-already-at-Level-5 factor with the largest
// EUR gain from moving up exactly ONE level (the source document's own
// example moves up one level, not straight to the max — Prompt 428's own
// instruction to default to that reading). null when there is nothing
// left to move: nothing answered yet, or every answered factor already at
// its own mode's top level.
//
// Both level->% tables (factors_v1.ts) are linear — every level step is
// worth the same %, so this delta actually TIES across every eligible
// factor at a given calibration. When it does, this breaks the tie toward
// the factor with the most overall room left (the lowest current level) —
// a defensible reading of "biggest margin" for the case the prompt itself
// doesn't resolve, not an arbitrary array-order pick.
export function berkusSensitivity(mode: BerkusMode, factors: BerkusFactorLevel[], refEur: number): BerkusSensitivity | null {
  let best: BerkusSensitivity | null = null;
  for (const f of factors) {
    if (f.level == null || f.skipped || f.level >= 5) continue;
    const deltaEur = berkusFactorEur(mode, f.level + 1, false, refEur) - berkusFactorEur(mode, f.level, false, refEur);
    if (!best || deltaEur > best.deltaEur || (deltaEur === best.deltaEur && f.level < best.fromLevel)) {
      best = { factor: f.key, fromLevel: f.level, toLevel: f.level + 1, deltaEur };
    }
  }
  return best;
}
