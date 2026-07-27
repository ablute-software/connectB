// /automations merged into /settings (separador "Automations"). This route
// used to render its own standalone copy of <AutomationsPanel/> (batch 3 A) —
// that duplication is exactly what this batch closes: the panel now lives
// only inside Settings, and this route is just a redirect like the others.
// Permanent redirect (308, permanentRedirect()) — the target never changes
// at runtime.
import { permanentRedirect } from 'next/navigation';

export default function AutomationsRedirect() {
  permanentRedirect('/settings?tab=automations');
}
