// /needs-review moved into /settings (separador "Needs review") — it used
// to live under /queue, but Queue was dissolved back into a bare Outbox.
// Permanent redirect (308, permanentRedirect()) — the target never changes
// at runtime.
import { permanentRedirect } from 'next/navigation';

export default function NeedsReviewRedirect() {
  permanentRedirect('/settings?tab=needs-review');
}
