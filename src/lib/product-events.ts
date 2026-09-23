// Prompt 727 §6 — minimal product-usage instrumentation, client-safe (no
// 'server-only', called directly from client components). Fire-and-forget:
// never blocks, never surfaces an error to the caller — a missed analytics
// event is not a reason to interrupt a founder's flow. The server route
// itself no-ops until the proposed product_events migration is applied
// (productEventsAvailable), so this is safe to call today even though
// nothing is written yet.
export type ProductEvent = 'dossier_opened' | 'next_step_seen' | 'message_copied' | 'log_prefilled' | 'interaction_logged';

export function emitProductEvent(event: ProductEvent, opts: { entityId?: string } = {}): void {
  fetch('/api/product-events', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event, entityId: opts.entityId }),
  }).catch(() => {});
}
