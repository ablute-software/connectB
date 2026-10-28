// Prompt 918 (I3) — what the Applications tab shows about the eligibility of an application, built in one place (pure) from the current result and the state of its task, so the list, the detail and the
// tests read the same thing. "Processing" is an application that has no result yet; "Technical failure" is one whose evaluation could not run (never an incumprimento).
import type { Outcome } from './eligibility';
import type { CurrentEligibility } from './eligibility-review';

export type EligibilityView = 'fit' | 'not_fit' | 'to_validate' | 'processing';
export type EligibilityState = 'fit' | 'not_fit' | 'to_validate' | 'queued' | 'processing' | 'technical_failure';

export const ELIGIBILITY_LABEL: Record<EligibilityState, string> = {
  fit: 'Fit', not_fit: 'Not a fit', to_validate: 'To validate', queued: 'Queued', processing: 'Processing', technical_failure: 'Technical failure',
};

export interface RuleLine {
  ruleId: string; kind: string; sentence: string;
  /** What the engine said, and what stands now (a person may have decided otherwise). */
  engine: Outcome; effective: Outcome; reason: string;
  evidence: { quote?: string; page?: number | null; fileName?: string } | null;
  override: { outcome: Outcome; by: string; why: string; at: string } | null;
}
export interface EligibilityInfo {
  state: EligibilityState;
  reason: string;
  source: 'engine' | 'human' | 'flag' | null;
  rulesVersion: number | null;
  rules: RuleLine[];
  /** A person reclassified the whole application. */
  reclassified: { status: string; by: string; why: string; at: string } | null;
  /** Technical failure: why (for the team), and that it can be retried. */
  error: string | null;
}

/** The list a state belongs to: Fit / Not a fit / To validate, and everything not yet evaluated (queued, processing, technical failure) in "Processing". */
export const viewOf = (s: EligibilityState): EligibilityView => (s === 'fit' || s === 'not_fit' || s === 'to_validate' ? s : 'processing');

export function buildInfo(current: CurrentEligibility | null, task: { status: string; lastError: string | null } | null): EligibilityInfo {
  if (!current) {
    const state: EligibilityState = task?.status === 'technical_failure' ? 'technical_failure' : task?.status === 'processing' ? 'processing' : 'queued';
    return { state, reason: state === 'technical_failure' ? 'The automatic check could not run. It was not counted against the applicant; a person can retry it.' : 'The automatic check has not finished yet.', source: null, rulesVersion: null, rules: [], reclassified: null, error: task?.lastError ?? null };
  }
  const app = current.overrides._application ?? null;
  return {
    state: current.status, reason: current.reason, source: current.source, rulesVersion: current.rulesVersion, error: null,
    reclassified: app && app.status ? { status: app.status, by: app.by, why: app.why, at: app.at } : null,
    rules: current.ruleResults.map((r) => {
      const ov = current.overrides[r.ruleId];
      const override = ov && ov.outcome ? { outcome: ov.outcome, by: ov.by, why: ov.why, at: ov.at } : null;
      return { ruleId: r.ruleId, kind: r.kind, sentence: r.sentence, engine: r.outcome, effective: override?.outcome ?? r.outcome, reason: r.reason, evidence: r.evidence ?? null, override };
    }),
  };
}
