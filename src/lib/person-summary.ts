// Prompt 737 §9.A, Bloco C.2 — the dossier's 1-2 sentence factual summary.
// Deterministic, template-only, never generative: every clause is built
// directly from a real fetched count or field, never invented. Returns null
// when there's nothing solid enough to ground even one sentence (no primary
// affiliation on file at all) — the caller renders no section in that case,
// per the "never an empty card" rule.
export interface FactualSummaryInput {
  primaryTitle: string | null;
  primaryFirmName: string | null;
  strongEvidenceCount: number; // strength >= 3
  topTopicLabel: string | null;
}

export function buildFactualSummary(input: FactualSummaryInput): string | null {
  if (!input.primaryFirmName) return null;

  const role = input.primaryTitle ? input.primaryTitle : 'Current role unknown';
  let summary = `${role} at ${input.primaryFirmName}.`;

  if (input.strongEvidenceCount > 0) {
    summary += ` ${input.strongEvidenceCount} verified fact${input.strongEvidenceCount === 1 ? '' : 's'} on file.`;
  }
  if (input.topTopicLabel) {
    summary += ` Most associated with ${input.topTopicLabel}.`;
  }
  return summary;
}
