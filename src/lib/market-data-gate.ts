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

// Prompt 370 §B — the "From your documents" card's three honest states
// (plus the zero-documents edge case of state 2), extracted as a pure
// function so the exact bug the founder caught — "nothing found" shown
// when the truth was "never read" — has a test that can't silently regress
// inside JSX conditionals. NEVER 'nothing_found' when docsExtracted === 0
// and docsTotal > 0 — that combination is 'not_read', full stop.
export type MarketDataEmptyState = 'not_read' | 'no_documents' | 'nothing_found' | 'has_content';

export function marketDataEmptyState(
  docCounts: { docsTotal: number; docsExtracted: number } | null, docsWithMarketContentCount: number,
): MarketDataEmptyState {
  if (docsWithMarketContentCount > 0) return 'has_content';
  if (docCounts && docCounts.docsExtracted === 0 && docCounts.docsTotal > 0) return 'not_read';
  if (!docCounts || docCounts.docsTotal === 0) return 'no_documents';
  return 'nothing_found';
}
