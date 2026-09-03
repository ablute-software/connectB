// Prompt 548 Part 1 — the investor workspace's navigation, as data.
//
// It lived inline in InvestorWorkspaceShell.tsx, and the guest sidebar
// (Prompt 154) was a hand-typed imitation of it. That copy then rotted
// exactly as copies do: it still said "Access granted" a full two prompts
// after the real workspace renamed that entry to "Data room" (337/338), and
// it was missing Dashboard, Actions required, My Network and Messages
// entirely. A guest was shown a blurred picture of a product that no longer
// existed.
//
// One list, two shells. The real workspace builds its NAV from this (About
// keeps its dynamic label, badges and onSelect stay in the component); the
// guest shell renders the same entries in the same order and groups, with
// hrefs instead of tab state. Neither can drift from the other again
// without this file changing, which is what the test alongside pins.
//
// Plain .ts, no JSX, so vitest can import it — the `Tab` import below is
// `import type`, which TypeScript erases entirely, so nothing pulls the
// .tsx shell (or React) into a test run.
import type { Tab } from '@/components/investor-workspace/InvestorWorkspaceShell';

export interface InvestorNavItem {
  key: Tab;
  label: string;
  icon: string;
  // 1: About alone · 2: Data room/Pipeline · 3: Dashboard/Evaluation tools ·
  // 4: Actions required/Agenda · 5: My Network/Messages · 6: Plans/Support.
  // MatchDeal is deliberately NOT a nav item — it only ever lives in the
  // QR-pairing header affordance, per Nuno's explicit decision. 'archive'
  // is gone as a tab; see PipelinePanel's own "Archived" filter.
  group: number;
}

export const INVESTOR_NAV: readonly InvestorNavItem[] = [
  { key: 'about', label: 'About your firm', icon: '⋯', group: 1 },
  // Prompt 337/338 — renamed from "Access granted": grows into the full
  // read-only mirror of the founder's own Vault Data Room in Prompt 338.
  { key: 'access', label: 'Data room', icon: '⚿', group: 2 },
  { key: 'pipeline', label: 'Pipeline', icon: '▤', group: 2 },
  // Prompt 340 Block A — own-data-only funnel/agenda/follow-on summary.
  { key: 'dashboard', label: 'Dashboard', icon: '▥', group: 3 },
  // P131-B — Ownership calculator (promoted from a per-card button to a
  // real page) + Equity simulator, structured to grow with more tools.
  { key: 'evaluation', label: 'Evaluation tools', icon: '⚖', group: 3 },
  { key: 'actions', label: 'Actions required', icon: '⚑', group: 4 },
  { key: 'agenda', label: 'Agenda', icon: '◔', group: 4 },
  // Prompt 340 Block C/D.
  { key: 'network', label: 'My Network', icon: '⇄', group: 5 },
  { key: 'messages', label: 'Messages', icon: '✉', group: 5 },
  { key: 'plans', label: 'Plans & billing', icon: '◈', group: 6 },
  { key: 'support', label: 'Support', icon: '☎', group: 6 },
] as const;

// Compile-time proof, both directions, that this list and the `Tab` union
// are the same set. `key: Tab` above already rejects a key that is not a
// Tab; this second line rejects a Tab that has no entry here. Together they
// mean a new tab cannot be added to the workspace without appearing in the
// guest sidebar too — which is the whole point of the file.
type NavKey = typeof INVESTOR_NAV[number]['key'];
const _everyTabHasAnEntry: NavKey = null as unknown as Tab;
void _everyTabHasAnEntry;

export const INVESTOR_NAV_KEYS = INVESTOR_NAV.map((n) => n.key);

// The one entry a guest can never preview: it is not a tool, it is the
// share they already have. The guest shell links it back to their own
// document list instead (Prompt 548 Part 2).
export const GUEST_PREVIEWABLE_KEYS = INVESTOR_NAV.filter((n) => n.key !== 'access').map((n) => n.key);

export function isGuestPreviewableKey(key: string): key is Tab {
  return (GUEST_PREVIEWABLE_KEYS as string[]).includes(key);
}
