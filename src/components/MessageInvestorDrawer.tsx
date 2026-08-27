'use client';
// Prompt 197 A §2 — founder-side Sherlock messaging on the entity detail
// page. Prompt 397 §B.4.1 — the thread+composer core now lives in
// MessageThreadCore.tsx (shared with the entity page's inline conversation
// panel); this file is just the drawer chrome around it, mirrored off
// ThreadDrawer.tsx's own structure so the two drawers read as one family.
import { MessageThreadCore } from '@/components/MessageThreadCore';

export function MessageInvestorDrawer({
  investorName, entityId, investorCatalogEntityId, open, onClose, initialBody,
}: {
  investorName: string;
  entityId: string;
  investorCatalogEntityId: string;
  open: boolean;
  onClose: () => void;
  initialBody?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-gray-900">Message {investorName}</h2>
              <p className="mt-0.5 text-xs text-gray-500">Sherlock messaging — one continuous thread with this firm.</p>
            </div>
            <button onClick={onClose} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50">Close</button>
          </div>
        </div>
        <div className="px-5 py-4">
          <MessageThreadCore entityId={entityId} investorCatalogEntityId={investorCatalogEntityId} initialBody={initialBody} />
        </div>
      </div>
    </div>
  );
}
