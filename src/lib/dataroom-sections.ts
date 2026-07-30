// Investor Workspace Fase 2 (prompt 55) — the 6 fixed diligence-journey
// sections, in order. Shared between the portal API route (grouping) and
// the client (section labels) so the two never drift.
export const PORTAL_SECTIONS = [
  { key: 'start_here', label: 'Start here' },
  { key: 'product_market', label: 'Product & market' },
  { key: 'traction_commercial', label: 'Traction & commercial' },
  { key: 'financial', label: 'Financial' },
  { key: 'team_governance', label: 'Team & governance' },
  { key: 'round_terms', label: 'Round terms' },
] as const;

export type PortalSectionKey = typeof PORTAL_SECTIONS[number]['key'];
