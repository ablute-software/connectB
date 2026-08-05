'use client';
// P133 (item 10) — investor-side interaction log drawer. Mirrors the
// founder-side CRM's own ThreadDrawer.tsx shell (fixed right-side panel,
// sticky header, timeline list) — the exact UI shape this feature is meant
// to be the investor-side counterpart of. Founder has no route that reads
// this data at all (see /api/portal/interaction-log's own header comment).
//
// P134-B — the form + timeline body itself now lives in
// InteractionLogTimeline.tsx, shared with the dossier's own Activity tab;
// this component is just the drawer chrome (overlay, panel, sticky title,
// close button) around it, unchanged for every existing caller.
import { InteractionLogTimeline } from './InteractionLogTimeline';

export function InteractionLogDrawer({ orgId, orgName, onClose }: { orgId: string; orgName: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-gray-900">{orgName}</h2>
              <p className="mt-0.5 text-xs text-gray-500">Interaction log — private to your firm.</p>
            </div>
            <button onClick={onClose} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50">Close</button>
          </div>
        </div>
        <div className="px-5 py-4">
          <InteractionLogTimeline orgId={orgId} />
        </div>
      </div>
    </div>
  );
}
