// Prompt 605 §A — "Preencham-na automaticamente com o sítio da app onde a
// sugestão foi levantada [...] a partir da rota, sem perguntar ao
// utilizador. Uma sugestão sem saber de que ecrã veio vale metade."
//
// The labels are the SAME strings the Report-a-problem widget has always
// offered in its dropdown, on purpose: `support_tickets.area` is one column
// read by one back-office list, and a route-derived 'Vault Data Room' that
// didn't match the hand-picked 'Vault Data Room' would silently split that
// column into two vocabularies.
//
// Pure and exhaustive over the app's real top-level routes; anything
// unrecognised falls through to 'Other' rather than inventing a label.

export const SUPPORT_AREAS = [
  'Pipeline', 'Tasks & Agenda', 'Dashboard', 'Vault Data Room', 'Company / Profile',
  'Plans & billing', 'MatchDeal', 'Account', 'Back-office', 'Investor portal', 'Other',
] as const;
export type SupportArea = (typeof SUPPORT_AREAS)[number];

// Longest-prefix wins, so '/settings/billing' resolves to billing rather
// than to the '/settings' entry above it. Order in this list is irrelevant
// — the match is by segment length, not by position.
const ROUTES: { prefix: string; area: SupportArea }[] = [
  { prefix: '/pipeline', area: 'Pipeline' },
  { prefix: '/entities', area: 'Pipeline' },
  { prefix: '/people', area: 'Pipeline' },
  { prefix: '/outbox', area: 'Pipeline' },
  { prefix: '/today', area: 'Tasks & Agenda' },
  { prefix: '/tasks', area: 'Tasks & Agenda' },
  { prefix: '/agenda', area: 'Tasks & Agenda' },
  { prefix: '/automations', area: 'Tasks & Agenda' },
  { prefix: '/dashboard', area: 'Dashboard' },
  { prefix: '/vault', area: 'Vault Data Room' },
  { prefix: '/documents', area: 'Vault Data Room' },
  { prefix: '/guest', area: 'Vault Data Room' },
  { prefix: '/company', area: 'Company / Profile' },
  { prefix: '/settings', area: 'Company / Profile' },
  { prefix: '/settings/billing', area: 'Plans & billing' },
  { prefix: '/plans', area: 'Plans & billing' },
  { prefix: '/billing', area: 'Plans & billing' },
  { prefix: '/matchdeal', area: 'MatchDeal' },
  { prefix: '/network', area: 'MatchDeal' },
  { prefix: '/account', area: 'Account' },
  { prefix: '/welcome', area: 'Account' },
  { prefix: '/login', area: 'Account' },
  { prefix: '/signup', area: 'Account' },
  { prefix: '/backoffice', area: 'Back-office' },
  { prefix: '/metrics', area: 'Back-office' },
  { prefix: '/portal', area: 'Investor portal' },
];

/** Maps a pathname (never a full URL — no query string, no origin) to the
 *  area label stored on the ticket. */
export function areaFromPath(pathname: string | null | undefined): SupportArea {
  if (!pathname) return 'Other';
  const path = pathname.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  let best: { len: number; area: SupportArea } | null = null;
  for (const r of ROUTES) {
    if (path === r.prefix || path.startsWith(`${r.prefix}/`)) {
      if (!best || r.prefix.length > best.len) best = { len: r.prefix.length, area: r.area };
    }
  }
  return best?.area ?? 'Other';
}
