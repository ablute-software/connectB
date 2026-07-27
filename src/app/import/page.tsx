// /import merged into /settings (separador "Import history"). Permanent
// redirect (308, permanentRedirect()) — the target never changes at runtime.
// /import/md and /import/structured are untouched — they stay real routes,
// linked to from inside the Import history panel.
import { permanentRedirect } from 'next/navigation';

export default function ImportRedirect() {
  permanentRedirect('/settings?tab=import-history');
}
