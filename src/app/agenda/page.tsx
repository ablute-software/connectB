// /agenda merged into /today (separador "Agenda"). Permanent redirect so no
// old link/bookmark 404s — permanentRedirect() issues a 308, the correct
// status for a route that has moved for good (this target never changes at
// runtime, unlike /company below, so a cached 308 is safe here).
import { permanentRedirect } from 'next/navigation';

export default function AgendaRedirect() {
  permanentRedirect('/today?tab=agenda');
}
