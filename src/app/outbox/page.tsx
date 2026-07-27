// /outbox merged into /queue (separador "Outbox"). Permanent redirect (308,
// permanentRedirect()) — the target never changes at runtime.
import { permanentRedirect } from 'next/navigation';

export default function OutboxRedirect() {
  permanentRedirect('/queue?tab=outbox');
}
