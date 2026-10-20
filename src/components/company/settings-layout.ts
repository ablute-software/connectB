// The ONE place that says where the About page's sticky header ENDS, for everything that has to stick below it or scroll to just under it (CompanyPanel's
// sticky sub-menu and badges columns, the landing spot of a section).
//
// It used to be a measured constant, SETTINGS_HEADER_OFFSET_PX = 148 ("measured live at 1366x768"). That was right on the day and wrong on every other day:
// the header is a title row + the visibility pill (which wraps onto a second line with its explanation) + the tab bar + the completeness bar, so its height
// follows the viewport width and the text in it. Nuno's report of 20/10/2026 ("every time a tab opens the app scrolls down, and fields end up hidden") was
// that constant being too small: CompanyPanel scrolled each section to 148px from the top while the header actually ended 38px (at 1366) to ~75px (at 1600)
// lower, so the first rows of the section sat UNDER the header, and the sub-menu and badges columns stuck 38–75px too high — under it as well.
//
// Now nothing is assumed. The header's two parts publish their own height as CSS variables — the workspace bar (`--workspace-header-height`, by
// WorkspaceHeader) and this page's sticky block (`--settings-sticky-height`, by useSettingsStickyHeight, a ResizeObserver) — and the offset is the sum, in CSS,
// so it follows both live. The px constant survives only as the fallback for the first frame, before anything has been measured.
export const SETTINGS_HEADER_OFFSET_PX = 148;

/** Set on <html> by useSettingsStickyHeight while the About page is mounted: the height of the page's own sticky block. */
export const SETTINGS_STICKY_HEIGHT_VAR = '--settings-sticky-height';

/**
 * First-frame fallbacks (px). The workspace bar's is the SAME fallback WorkspaceHeader gives its own sticky offset (73), so the two never disagree before
 * anything is measured; the page block's is whatever makes the pair add up to the old constant.
 */
const WORKSPACE_HEADER_HEIGHT_VAR = '--workspace-header-height';
const WORKSPACE_HEADER_HEIGHT_FALLBACK_PX = 73;
export const SETTINGS_STICKY_HEIGHT_FALLBACK_PX = SETTINGS_HEADER_OFFSET_PX - WORKSPACE_HEADER_HEIGHT_FALLBACK_PX;

/**
 * A CSS length: where the About header ends, measured from the top of the viewport. Used as `top` for sticky columns, as `scroll-margin-top` for a section
 * that is scrolled to, and (through a custom property) inside calc(100vh - …) for their max-height.
 */
export const SETTINGS_HEADER_OFFSET_CSS =
  `calc(var(${WORKSPACE_HEADER_HEIGHT_VAR}, ${WORKSPACE_HEADER_HEIGHT_FALLBACK_PX}px) + var(${SETTINGS_STICKY_HEIGHT_VAR}, ${SETTINGS_STICKY_HEIGHT_FALLBACK_PX}px))`;
