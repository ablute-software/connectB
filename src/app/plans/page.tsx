// /plans merged into /settings (separador "Plans & billing"). Permanent
// redirect (308, permanentRedirect()) — the target never changes at runtime.
import { permanentRedirect } from 'next/navigation';

export default function PlansRedirect() {
  permanentRedirect('/settings?tab=plans-billing');
}
