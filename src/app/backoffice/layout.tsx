// BLOCO 3 — the back-office console gets its OWN chrome, completely
// separate from the founder Shell (src/components/shell.tsx early-returns
// bare children for this route). The auth-gate + BackofficeShell wrapping
// itself lives in PlatformAdminLayout (Prompt 587 §C — extracted so
// /metrics/layout.tsx can share it instead of a second copy).
//
// Prompt 576 §3 — the flat top-nav-bar chrome this file used to render
// directly is replaced by BackofficeShell (the same WorkspaceSidebar/
// WorkspaceHeader the founder shell uses, in its own 6-group configuration —
// see that component's own header for why it's a sibling rather than a
// branch inside <Shell>). No route in this tree changes; every existing
// page under /backoffice/* renders exactly where it already did.
export { PlatformAdminLayout as default } from '@/components/backoffice/PlatformAdminLayout';
