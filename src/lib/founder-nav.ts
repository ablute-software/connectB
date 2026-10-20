// The founder workspace's left navigation: WHAT is in it and WHICH GROUP (visual card) each entry sits in. Pure data, so the grouping is tested instead
// of remembered (shell.tsx used to hold it as a private constant).
//
// Prompt 314 §B put the entries in groups, each drawn as its own card by WorkspaceSidebar (`groupStyle="cards"`). Nuno, 20/10/2026: Pipeline and
// Calls belong together (the two ways of reaching investors and programmes), and Tasks and Agenda belong together (the two ways of keeping time) —
// "it is only the visual card effect, not a merge of the tabs": every entry keeps its own page, its own badge and its own capability gate; only the
// `group` number — which decides which entries share a card — changed. The mobile bottom nav is built from the same list and ignores groups.
//
//   1. about {org} · Vault Data Room
//   2. Pipeline · Calls
//   3. Tasks · Agenda
//   4. My Network · Messages
//   5. Dashboard · Readiness & Train
//   6. Plans & billing · Help & support (Prompt 331: Help & support is not in this list — shell.tsx appends it to the SIDEBAR only, in the group below,
//      so it never reaches the mobile nav)
export interface FounderNavEntry {
  href: string; label: string; icon: string;
  /** The entry exists only when the workspace has this capability (`/api/me` capabilities). */
  requiresCapability?: 'companyCanon' | 'calls';
  group: number;
}

export const FOUNDER_NAV: FounderNavEntry[] = [
  { href: '/settings', label: 'about your company', icon: '⋯', group: 1 },
  { href: '/documents', label: 'Vault Data Room', icon: '▣', group: 1 },
  { href: '/pipeline', label: 'Pipeline', icon: '▤', group: 2 },
  // Prompt 907 (I4): open calls from investors and ecosystem organisations, and the startup's applications. Behind the Calls switch.
  { href: '/calls', label: 'Calls', icon: '◍', requiresCapability: 'calls', group: 2 },
  { href: '/tasks', label: 'Tasks', icon: '☀', group: 3 },
  { href: '/agenda', label: 'Agenda', icon: '◔', group: 3 },
  { href: '/network', label: 'My Network', icon: '⬡', group: 4 },
  { href: '/messages', label: 'Messages', icon: '✉', group: 4 },
  { href: '/dashboard', label: 'Dashboard', icon: '◈', group: 5 },
  { href: '/readiness', label: 'Readiness & Train', icon: '◎', requiresCapability: 'companyCanon', group: 5 },
  { href: '/plans', label: 'Plans & billing', icon: '◇', group: 6 },
];

/** "Help & support" sits in the same card as Plans & billing (no divider between them). */
export const HELP_SUPPORT_NAV_GROUP = 6;
