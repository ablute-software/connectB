'use client';
// Plans & billing — back to its own top-level page (it briefly lived as a
// separador inside Settings; that move is undone — always-visible billing
// shouldn't be a click away inside the company page). Renders the same
// PlansPanel unchanged, just not behind a tab.
import { PlansPanel } from '@/components/settings/PlansPanel';

export default function PlansPage() {
  return <PlansPanel />;
}
