import { WORKSPACE_HEADER_HEIGHT_PX } from '../workspace-shell/WorkspaceHeader';

// Prompt 377 §B — the ONE shared constant for the page-level sticky header
// (settings/page.tsx: title/link, VisibilityToggle, main tab bar,
// CompletenessBar) and CompanyPanel's own sticky sub-menu/badges columns.
// Kept in a single file, imported by both, so a header layout change in one
// place can never silently desync from the offset the other relies on —
// the exact failure mode a hand-copied magic number in two files invites.
// Measured against the real rendered header (title row + VisibilityToggle
// + tab bar + CompletenessBar) via the live browser during this prompt's
// own verification pass — adjust here, never re-derive it separately
// wherever it's used.
// Prompt 613 §H — was 232, measured when the block above stuck at top:0. It
// now sticks at 73 (below the workspace header, which it used to overlap and
// paint over), so everything measured against it moves down by exactly that
// much. 232 + WORKSPACE_HEADER_HEIGHT_PX. Kept as arithmetic rather than as a
// new measured number, so the relationship stays visible: if the header's
// height changes, this follows it instead of drifting.
export const SETTINGS_HEADER_OFFSET_PX = 232 + WORKSPACE_HEADER_HEIGHT_PX;
