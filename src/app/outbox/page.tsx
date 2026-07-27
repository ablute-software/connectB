'use client';
// Outbox — back to its own top-level page (it briefly lived merged with
// Needs review under /queue; that merge is undone — see /app/queue's
// redirect). Renders the same OutboxPanel unchanged, just not behind a tab.
import { OutboxPanel } from '@/components/queue/OutboxPanel';

export default function OutboxPage() {
  return <OutboxPanel />;
}
