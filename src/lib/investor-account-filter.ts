// Prompt 123 §C.4 — the backoffice-side half of the "new sign-up wiring"
// contract: a catalog entity becomes a real registered investor ACCOUNT
// (and shows in the Backoffice Investors tab) the moment it has its first
// active matchdeal_investor_members seat — not on catalog import, not on
// verification. This is the exact P124 358-vs-~8 distinction (catalog
// entities added vs. investor accounts registered) applied to the one
// place it actually gates UI: /api/backoffice/investor-accounts's filter.
export function isRegisteredInvestorAccount(seatsLinked: number): boolean {
  return seatsLinked > 0;
}
