// Prompt 373 §0.2 safeguard #3 — "search before create": match by
// lower(domain) first, then lower(name), and update the existing row
// instead of duplicating the same company. Pure decision function — the
// caller (the API route, with service-role) does the actual DB read/write;
// this only decides WHICH existing row (if any) a new candidate matches.
export interface MarketCompanyCandidate {
  name: string;
  domain?: string | null;
}
export interface ExistingMarketCompany {
  id: string;
  name: string;
  domain?: string | null;
}

export function findMatchingMarketCompany<T extends ExistingMarketCompany>(
  candidate: MarketCompanyCandidate, existing: T[],
): T | null {
  const domain = candidate.domain?.trim().toLowerCase();
  if (domain) {
    const byDomain = existing.find((c) => c.domain?.trim().toLowerCase() === domain);
    if (byDomain) return byDomain;
  }
  const name = candidate.name.trim().toLowerCase();
  return existing.find((c) => c.name.trim().toLowerCase() === name) ?? null;
}
