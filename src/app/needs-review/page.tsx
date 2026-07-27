// /needs-review merged into /queue (separador "Needs review"). Permanent
// redirect (308, permanentRedirect()) — the target never changes at runtime.
import { permanentRedirect } from 'next/navigation';

export default function NeedsReviewRedirect() {
  permanentRedirect('/queue?tab=needs-review');
}
