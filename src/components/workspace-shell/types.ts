// Prompt 127 Bloco A (addenda) — shared nav-item shape for WorkspaceSidebar
// and WorkspaceMobileNav. `href` present -> a real next/link (founder's
// route-based nav: browser history, right-click-open-in-new-tab, Next
// prefetch all keep working); `href` absent -> a <button onClick={onSelect}>
// (investor's local-state tab switch). The primitive never infers navigation
// mode from anything else, and `active` is always computed by the caller —
// founder matches on pathname (differently for the sidebar vs. the mobile
// nav: startsWith vs exact), investor on `tab === key` — baking either rule
// into the primitive would mean it secretly knows about routing or state.
import type { ReactNode } from 'react';

export interface WorkspaceNavItem {
  key: string;
  label: string;
  icon: string;
  active: boolean;
  href?: string;
  onSelect?: () => void;
  // Heavier "about {org/firm}" typographic treatment — both shells already
  // apply this to one item, generalized here to any item.
  emphasize?: boolean;
  // Amber pending-count pill. Founder-only today (Tasks/About); generic so
  // the investor side can use it once it has something to count.
  badge?: number;
  // Founder-only: onboarding tour anchors resolve `[data-tour-id="..."]`
  // against the whole document, so this attribute on the rendered <a> is
  // load-bearing for a tour mounted on a different page entirely, not
  // decorative — see the 'nav-readiness' anchor.
  tourId?: string;
  // Prompt 314 §B — founder sidebar grouping (WorkspaceSidebar renders a
  // subtle divider wherever this number changes between consecutive items).
  // Optional and unused by the investor/guest shells, which never set it —
  // their sidebars render exactly as before, with no dividers.
  group?: number;
  // Prompt 576 §3 — an uppercase heading above this item's group, read only
  // off the FIRST item of a new group run (subsequent items in the same run
  // ignore it). Optional and unused by founder/investor/guest today, whose
  // groups render unlabeled exactly as before.
  groupLabel?: string;
  // Opaque content at the right edge of the groupLabel row — a count badge
  // for a group whose members are decisions (Review), a status dot for one
  // that isn't (System). The primitive never decides what it means.
  groupMeta?: ReactNode;
  // Prompt 576 §3 — present in the nav but visually quiet: an "all clear"
  // item (no pending work) stays one click away rather than disappearing,
  // just without the emphasis a default item gets.
  dimmed?: boolean;
}
