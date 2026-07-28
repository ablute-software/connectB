// /needs-review moved into /settings, nested as a subtab of "Import history"
// (it used to be a sibling top-level separador, and before that lived under
// /queue, which was dissolved back into a bare Outbox).
// Permanent redirect (308, permanentRedirect()) — the target never changes
// at runtime. Old ?tab=needs-review links still resolve correctly too — see
// the effectiveTab/effectiveSubtab compat shim in settings/page.tsx.
import { permanentRedirect } from 'next/navigation';

export default function NeedsReviewRedirect() {
  permanentRedirect('/settings?tab=import-history&subtab=needs-review');
}
