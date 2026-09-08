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
// Prompt 615 — 148, and re-measured rather than adjusted. It was 232 when the
// About header was a title row, a card of pills, two coloured bands and a
// carded progress bar; 615 collapsed all of that onto one row plus the tabs
// plus a bare bar, and the block now sticks at the bottom of the workspace
// header. Measured live at 1366x768: workspace header 0-53, About block
// 53-148 when stuck. That 148 is this number.
//
// Still a measured constant rather than something derived, because it is read
// from JS (scrollMarginTop), where a CSS variable does not reach. If the
// header's contents change again, re-measure here — the value has no formula.
export const SETTINGS_HEADER_OFFSET_PX = 148;
