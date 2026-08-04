// Prompt 122 Block A (F0.5) — Metrics moved to /metrics (promoted to the
// founder Shell's own sidebar, Platform section). This redirect exists
// purely so old bookmarks/links to /backoffice/metrics keep working.
import { redirect } from 'next/navigation';

export default function BackofficeMetricsRedirect() {
  redirect('/metrics');
}
