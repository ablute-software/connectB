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
export const SETTINGS_HEADER_OFFSET_PX = 232;
