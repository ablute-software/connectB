'use client';
// Automations now live inside Settings (batch 3 A); this route stays for
// direct links and renders the same panel.
import { AutomationsPanel } from '@/components/AutomationsPanel';

export default function AutomationsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Automations</h1>
      <AutomationsPanel />
    </div>
  );
}
