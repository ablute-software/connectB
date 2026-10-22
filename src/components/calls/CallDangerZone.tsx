'use client';
// Prompt 909 (I1) — "Delete call" and "Archive call", at the bottom of the General tab. Not part of the call's configuration, so they work whatever its state: the server decides what is allowed.
//   Delete (Prompt 918, Adenda 2, C): in ANY state, by whoever may "Configure call": the person sees what goes and types the call's name; the call moves to "Deleted calls" for 30 days (restorable),
//           then it is removed for good. An open call is closed at once; applicants are told. It replaces "only before opening and with nobody applied".
//   Archive: for calls with applications, or already open or closed (an open call is closed first). It leaves the lists by default; "Show archived" brings it back.
import { useState } from 'react';
import { ARCHIVE_CONFIRM } from '@/lib/calls/list-view';
import { PURGE_DAYS } from '@/lib/calls/deletion';
import { DeleteCallDialog } from './DeleteCallDialog';

export interface DangerActions { canDelete: boolean; canArchive: boolean }

export function CallDangerZone({ callId, name, actions, status, canManage, busy, onDeleted, onArchive }: {
  callId: string; name: string; actions: DangerActions; status: string; canManage: boolean; busy: boolean;
  onDeleted: () => void; onArchive: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!canManage || status === 'archived') {
    return status === 'archived' ? (
      <>
        <p className="mt-8 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600" data-testid="archived-note">This call is archived. It stays out of your lists unless you choose “Show archived”.</p>
        {canManage && <ArchivedDelete onAsk={() => setAsking(true)} />}
        {asking && <DeleteCallDialog callId={callId} name={name} onClose={() => setAsking(false)} onDeleted={() => { setAsking(false); onDeleted(); }} />}
      </>
    ) : null;
  }
  return (
    <section className="mt-8 rounded-lg border border-gray-200 p-4" data-testid="danger-zone">
      <h2 className="text-sm font-semibold text-gray-900">Delete or archive</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <button type="button" disabled={!actions.canDelete || busy} data-testid="delete-call" onClick={() => setAsking(true)}
            className="min-h-[44px] rounded-lg border border-[#B00000] px-3 py-1.5 text-sm font-semibold text-[#B00000] hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">Delete call</button>
          <p className="mt-1.5 text-[11px] text-gray-500" data-testid="delete-hint">Moves the call to “Deleted calls”; you can restore it for {PURGE_DAYS} days, then it is removed for good.</p>
        </div>
        <div>
          <button type="button" disabled={!actions.canArchive || busy} data-testid="archive-call"
            onClick={() => { if (window.confirm(ARCHIVE_CONFIRM)) onArchive(); }}
            className="min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">Archive call</button>
          <p className="mt-1.5 text-[11px] text-gray-500">
            {actions.canArchive ? 'Keeps everything, including applications, and takes the call out of the lists.' : 'Close the call before archiving it.'}
          </p>
        </div>
      </div>
      {asking && <DeleteCallDialog callId={callId} name={name} onClose={() => setAsking(false)} onDeleted={() => { setAsking(false); onDeleted(); }} />}
    </section>
  );
}

/** An archived call can be deleted too (the editor shows nothing else of this zone for it). */
function ArchivedDelete({ onAsk }: { onAsk: () => void }) {
  return (
    <div className="mt-3">
      <button type="button" onClick={onAsk} data-testid="delete-call" className="min-h-[44px] rounded-lg border border-[#B00000] px-3 py-1.5 text-sm font-semibold text-[#B00000] hover:bg-red-50">Delete call</button>
      <p className="mt-1.5 text-[11px] text-gray-500">Moves the call to “Deleted calls”; you can restore it for {PURGE_DAYS} days, then it is removed for good.</p>
    </div>
  );
}
