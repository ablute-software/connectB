// IRM_SPEC §11 — pure Company Canon logic: the composer provenance gate
// contract (§11b), the consistency-engine delta (§11c), and the
// misalignment verdict (§11d). Deliberately separate from
// company-canon.ts (which has `server-only` and does real Supabase I/O) so
// this file can be imported by the client, the server, AND vitest fixtures
// with no DB and no network — that's what lets the gate contract, the
// delta, and the verdict all get real unit tests tonight without a
// migration having to be applied first.
import type { CompanyFact, Entity } from './types';

// ---------- §11b provenance gate contract ----------

export interface ComposerClaim {
  text: string; // the sentence/clause this claim covers, verbatim from the draft
  factId?: string; // a confirmed company_facts.id this claim traces to
  needsConfirmation?: { question: string; options: string[] };
}

export interface ComposerDraftWithClaims {
  subject: string;
  body: string;
  rationale: string;
  confidence: number;
  claims: ComposerClaim[];
}

export interface GateResult {
  grounded: boolean;
  ungroundedClaims: ComposerClaim[]; // claims with neither a valid factId nor needsConfirmation
  pendingQuestions: ComposerClaim[]; // claims flagged needsConfirmation — draft must NOT be shown while any remain
}

// HARD gate (chosen over soft-marking, per §11b): a draft is only ever
// shown once every claim traces to a confirmed fact. A claim that names a
// factId not in the confirmed set is treated as ungrounded, not trusted —
// the model doesn't get benefit of the doubt on an id it invented.
export function evaluateProvenanceGate(draft: ComposerDraftWithClaims, confirmedFactIds: Set<string>): GateResult {
  const pendingQuestions = draft.claims.filter((c) => !!c.needsConfirmation);
  const ungroundedClaims = draft.claims.filter((c) => !c.needsConfirmation && (!c.factId || !confirmedFactIds.has(c.factId)));
  return { grounded: pendingQuestions.length === 0 && ungroundedClaims.length === 0, ungroundedClaims, pendingQuestions };
}

// ---------- §11c consistency engine — canon delta since a given date ----------

export interface CanonDelta {
  supersededSinceDate: CompanyFact[]; // facts that stopped being current after sinceDate
  newSinceDate: CompanyFact[]; // facts that became current after sinceDate
}

// "Since a given date" (typically the entity's last contact / pass date) —
// this delta IS the re-approach argument (§11c): what changed since we
// last talked. The system supplies it; the composer never reconstructs it
// from memory.
export function computeCanonDelta(facts: CompanyFact[], sinceDate: string): CanonDelta {
  const supersededSinceDate = facts.filter((f) => f.status === 'deprecated' && f.updated_at > sinceDate);
  const newSinceDate = facts.filter((f) => f.status === 'confirmed' && (f.valid_from ?? f.created_at) > sinceDate);
  return { supersededSinceDate, newSinceDate };
}

// ---------- §11d misalignment alert ----------

export interface AlignmentVerdict {
  status: 'aligned' | 'caution' | 'misaligned';
  reasons: string[];
}

const HARDWARE_POSITIVE = /\b(hardware|device|medical device|diagnostic)\b/i;
const WELLNESS_POSITIVE = /\b(wellness|biosphere|non-?medical|lifestyle)\b/i;

function extractRoundRangeEur(facts: CompanyFact[]): { min?: number; max?: number } {
  // Looks for figures like "€1.3M", "€300k" in confirmed financing facts —
  // a heuristic text scan, not a structured field (company_facts.statement
  // is free text by design, §11a). Deliberately conservative: only pulls
  // numbers it can parse cleanly, never guesses.
  const financing = facts.filter((f) => f.category === 'financing' && f.status === 'confirmed');
  const amounts: number[] = [];
  for (const f of financing) {
    const matches = f.statement.matchAll(/€\s?([\d.,]+)\s?(k|m|million)?/gi);
    for (const m of matches) {
      const raw = parseFloat(m[1].replace(/,/g, ''));
      const unit = (m[2] ?? '').toLowerCase();
      const eur = unit === 'k' ? raw * 1_000 : unit.startsWith('m') ? raw * 1_000_000 : raw;
      if (!Number.isNaN(eur)) amounts.push(eur);
    }
  }
  if (amounts.length === 0) return {};
  return { min: Math.min(...amounts), max: Math.max(...amounts) };
}

// Compares an entity's known profile (stage, cheque range, hardware
// stance) against the confirmed canon (round size, positioning) to catch
// the exact class of mistake that motivated §11 — pitching a fund whose
// mandate no longer matches what the company actually is. This is a
// heuristic text/number scan of free-text facts, not semantic
// understanding — it catches clear numeric/keyword mismatches, not every
// possible misalignment. Treat "aligned" as "nothing obvious flagged",
// not as a guarantee.
export function computeAlignment(entity: Entity, canonFacts: CompanyFact[]): AlignmentVerdict {
  // Each finding carries its own severity explicitly — inferring severity
  // by re-parsing the reason text (e.g. checking for the word "exceeds")
  // is exactly the kind of fragile heuristic this function is meant to
  // replace; a caught bug here during testing confirmed why.
  const findings: { text: string; severity: 'misaligned' | 'caution' }[] = [];
  const confirmed = canonFacts.filter((f) => f.status === 'confirmed');

  const round = extractRoundRangeEur(confirmed);
  if (round.max != null && entity.check_min_eur != null && round.max < entity.check_min_eur) {
    findings.push({
      severity: 'misaligned',
      text: `Round size (up to ~€${(round.max / 1000).toFixed(0)}k) is below this fund's minimum cheque (€${(entity.check_min_eur / 1000).toFixed(0)}k).`,
    });
  }
  if (round.min != null && entity.check_max_eur != null && round.min > entity.check_max_eur) {
    findings.push({
      severity: 'misaligned',
      text: `Round size (from ~€${(round.min / 1000).toFixed(0)}k) exceeds this fund's maximum cheque (€${(entity.check_max_eur / 1000).toFixed(0)}k).`,
    });
  }

  const positioningFacts = confirmed.filter((f) => f.category === 'positioning');
  const positioningText = positioningFacts.map((f) => f.statement).join(' ');
  const companyIsWellness = WELLNESS_POSITIVE.test(positioningText);
  const companyIsHardware = HARDWARE_POSITIVE.test(positioningText) && !companyIsWellness;
  if (entity.hardware_stance && companyIsWellness && HARDWARE_POSITIVE.test(entity.hardware_stance)) {
    findings.push({
      severity: 'misaligned',
      text: `This fund's hardware stance ("${entity.hardware_stance}") conflicts with the confirmed wellness/non-hardware positioning.`,
    });
  }
  if (entity.hardware_stance && companyIsHardware && WELLNESS_POSITIVE.test(entity.hardware_stance)) {
    findings.push({
      severity: 'misaligned',
      text: `This fund avoids hardware, but the confirmed positioning still frames the company as hardware/device-led.`,
    });
  }

  const status = findings.some((f) => f.severity === 'misaligned') ? 'misaligned' : findings.length > 0 ? 'caution' : 'aligned';
  return { status, reasons: findings.map((f) => f.text) };
}
