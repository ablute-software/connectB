// Prompt 94 — /outbox is superseded: it's now the "Warrants" sub-tab of the
// new /tasks (see WarrantsPanel.tsx, which also splits it further into
// Pending Review / Data Room Mail Access). Permanent redirect so no old
// link/bookmark 404s.
import { permanentRedirect } from 'next/navigation';

export default function OutboxRedirect() {
  permanentRedirect('/tasks?tab=warrants');
}
