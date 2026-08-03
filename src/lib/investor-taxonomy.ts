// Prompt 110 — shared investor-profile label maps. Extracted from three
// separate copies (InvestorProfilePanel.tsx, portal/page.tsx, and now
// MatchDealDeck.tsx) into one place, per the prompt's explicit "não criar
// uma terceira cópia" instruction. All three source copies used identical
// values before this extraction — confirmed by direct comparison, not
// assumed.
export const INSTRUMENT_LABELS: Record<string, string> = {
  equity: 'Equity', safe: 'SAFE', convertible_note: 'Convertible note',
  venture_debt: 'Venture debt', grant: 'Grant / subsidy', revenue_based: 'Revenue-based',
};

// Slide-facing copy (MatchDealDeck's "Role in the round" field). Keeps
// co_lead -> "Follows" consistent with the wording InvestorProfilePanel.tsx
// already shipped for its own editor — changing that wording means
// changing it in both places at once, never just one.
export const LEAD_OR_COLEAD_LABELS: Record<string, string> = {
  lead: 'Leads rounds', co_lead: 'Follows', both: 'Leads or follows',
};
