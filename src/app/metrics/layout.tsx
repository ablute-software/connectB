// Prompt 587 §C — Metrics moves into the back-office's own chrome
// (BackofficeShell, dark theme, Insight section) instead of the founder
// Shell's "Platform" sidebar item it lived under since Prompt 122 Block A.
// The route itself is unchanged (still /metrics — every existing link,
// including BackofficeShell's own Insight → Metrics item, keeps working
// with no redirect hop); only what wraps it changes. Same
// PlatformAdminLayout /backoffice/layout.tsx uses, so the auth-gate and the
// shell itself never drift between the two.
export { PlatformAdminLayout as default } from '@/components/backoffice/PlatformAdminLayout';
