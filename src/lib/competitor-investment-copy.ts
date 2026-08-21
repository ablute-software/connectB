// Prompt 292 §Fase 1 (Pedido 6) — shared copy for the portfolio-signal
// highlight, used by both the Pipeline row badge and the dossier card so
// the two surfaces never drift into different wording for the same fact.
//
// Deliberately does NOT say "declared competitor" (the prompt's own
// example copy does) — that claim depends on Pedido 3 (org.competitors),
// which is explicitly Fase 2/out of scope here. Fase 1 only ever shows
// investments an admin chose to record in the first place, which already
// implies relevance — the copy states the fact plainly instead of a claim
// this phase can't yet back up.
export interface CompetitorInvestmentItem {
  entityId: string | null;
  companyName: string | null;
  amountEur: number | null;
  investedAt: string | null;
  roundType: string | null;
  stillHeld: boolean | null;
  soldAt: string | null;
  soldAmountEur: number | null;
  confidence: 'high' | 'medium' | 'low' | null;
}

function fmtEurK(n: number): string {
  return `€${Math.round(n / 1000).toLocaleString('en-US')}k`;
}

export function competitorInvestmentSummary(item: CompetitorInvestmentItem): string {
  const company = item.companyName ?? 'a company';
  const amount = item.amountEur != null ? `${fmtEurK(item.amountEur)} ` : '';
  const year = item.investedAt ? item.investedAt.slice(0, 4) : null;
  const when = year ? `in ${year} ` : '';
  const status = item.stillHeld === false
    ? `— sold${item.soldAt ? ` in ${item.soldAt.slice(0, 4)}` : ''}${item.soldAmountEur != null ? ` for ${fmtEurK(item.soldAmountEur)}` : ''}`
    : item.stillHeld === true ? '— still holds the position' : '';
  return `Invested in ${company}, ${amount}${when}${status}`.replace(/\s+/g, ' ').trim();
}
