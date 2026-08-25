// Prompt 373 §C — "the bridge that justifies the app": investors who
// financed this org's competitors, cross-referenced against the founder's
// own pipeline. Pure and mechanical — one investor can back several
// competitors; each is grouped once, with every backed competitor listed,
// and the founder's own pipeline lookup decides in vs. missing.
export interface CompetitorInvestmentFact {
  investorEntityId: string;
  investorName: string;
  companyName: string;
  amountEur: number | null;
  investedAt: string | null; // ISO date
  roundType: string | null;
}

export interface BridgeInvestor {
  investorEntityId: string;
  investorName: string;
  backedCompanies: { companyName: string; amountEur: number | null; investedAt: string | null; roundType: string | null }[];
  // Pre-written, verifiable hook for the FIRST/most-recent investment,
  // grounded in real facts already in the library — never invented.
  hookLine: string;
  inPipeline: boolean;
  pipelineEntityId: string | null;
}

function yearOf(iso: string | null): string | null {
  if (!iso) return null;
  const y = new Date(iso).getUTCFullYear();
  return Number.isNaN(y) ? null : String(y);
}

// Prompt 373 §C.2 — "invested in {company} in {year}, {round type} round" —
// exactly the founder's own wording, built only from facts this row
// already carries (never a template that could outrun its own source).
export function investorHookLine(fact: { companyName: string; investedAt: string | null; roundType: string | null }): string {
  const year = yearOf(fact.investedAt);
  const parts = [`invested in ${fact.companyName}`];
  if (year) parts.push(`in ${year}`);
  const tail = parts.join(' ');
  return fact.roundType ? `${tail}, ${fact.roundType} round` : tail;
}

export interface CrossReferenceResult {
  inPipeline: BridgeInvestor[];
  missing: BridgeInvestor[];
}

export function crossReferenceInvestors(
  facts: CompetitorInvestmentFact[],
  // catalog_entities.id -> the org's own entities.id, or null/absent if
  // never delivered to this org's pipeline (catalog_deliveries, the
  // existing, correct join key — see market-investor-bridge's own route
  // for why this is the ONE reliable resolution mechanism in this codebase).
  pipelineEntityIdByCatalogId: Map<string, string | null>,
): CrossReferenceResult {
  const byInvestor = new Map<string, BridgeInvestor>();
  for (const f of facts) {
    const existing = byInvestor.get(f.investorEntityId);
    const backed = { companyName: f.companyName, amountEur: f.amountEur, investedAt: f.investedAt, roundType: f.roundType };
    if (existing) {
      existing.backedCompanies.push(backed);
      // Keep the hook pointed at the MOST RECENT known investment —
      // sorted once at the end below, not on every push.
    } else {
      const pipelineEntityId = pipelineEntityIdByCatalogId.get(f.investorEntityId) ?? null;
      byInvestor.set(f.investorEntityId, {
        investorEntityId: f.investorEntityId, investorName: f.investorName,
        backedCompanies: [backed], hookLine: investorHookLine(backed),
        inPipeline: !!pipelineEntityId, pipelineEntityId,
      });
    }
  }

  const investors = [...byInvestor.values()].map((inv) => {
    const mostRecent = [...inv.backedCompanies].sort((a, b) => (b.investedAt ?? '').localeCompare(a.investedAt ?? ''))[0];
    return { ...inv, hookLine: investorHookLine(mostRecent) };
  });

  return {
    inPipeline: investors.filter((i) => i.inPipeline),
    missing: investors.filter((i) => !i.inPipeline),
  };
}
