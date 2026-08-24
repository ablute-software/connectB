// Prompt 360 §A.3 — the Market data tab's own gate: mechanical, verifiable,
// same "pure function, no AI, checked both client and server" discipline as
// checkMiniPitchGate (mini-pitch.ts). Fail-closed: the server route below
// re-checks this itself rather than trusting a client that already passed
// it once — same "never trust a single layer for a gate" rule this
// codebase applies everywhere else.
export interface MarketDataGateOrgInput {
  sectors: string[] | null;
  stage: string | null;
  oneLiner: string | null;
}

export interface MarketDataGateMissingField { key: string; label: string; href: string }

export interface MarketDataGateResult { eligible: boolean; missing: MarketDataGateMissingField[] }

export function checkMarketDataGate(
  org: MarketDataGateOrgInput, hasExtractedDocument: boolean, hasMarketOrSolutionClaim: boolean,
): MarketDataGateResult {
  const missing: MarketDataGateMissingField[] = [];
  if (!org.sectors || org.sectors.length === 0) missing.push({ key: 'sectors', label: 'Your sectors', href: '/settings?tab=company' });
  if (!org.stage) missing.push({ key: 'stage', label: 'Your stage', href: '/settings?tab=company' });
  if (!org.oneLiner?.trim()) missing.push({ key: 'one_liner', label: 'A one-liner', href: '/settings?tab=company' });
  if (!hasExtractedDocument && !hasMarketOrSolutionClaim) {
    missing.push({ key: 'minimum_knowledge', label: 'At least one Vault document or an accepted market/solution claim', href: '/documents' });
  }
  return { eligible: missing.length === 0, missing };
}
