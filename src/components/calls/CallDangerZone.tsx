'use client';
// Prompt 909 (I1) — "Delete call" and "Archive call", at the bottom of the General tab. Not part of the call's
// configuration, so they work whatever its state: the server decides what is allowed and says why when it is not.
//   Delete: only before the call opens and only if nobody has applied (in any state). The call, its phases and its form
//           go; a record of who deleted what and when stays.
//   Archive: for calls with applications, or already open or closed (an open call is closed first). It leaves the
//            lists by default; "Show archived" brings it back.
import { ARCHIVE_CONFIRM, DELETE_CONFIRM } from '@/lib/calls/list-view';
import { deleteProblem } from '@/lib/calls/lifecycle';
import type { CallStatus } from '@/lib/calls/types';

export interface DangerActions { canDelete: boolean; canArchive: boolean; /** Why it cannot be deleted — the sentence the server answers with. */ deleteProblem?: string | null }

export function CallDangerZone({ actions, status, applicationsTotal, canManage, busy, onDelete, onArchive }: {
  actions: DangerActions; status: string; applicationsTotal: number; canManage: boolean; busy: boolean;
  onDelete: () => void; onArchive: () => void;
}) {
  if (!canManage || status === 'archived') {
    return status === 'archived' ? (
      <p className="mt-8 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600" data-testid="archived-note">This call is archived. It stays out of your lists unless you choose “Show archived”.</p>
    ) : null;
  }
  return (
    <section className="mt-8 rounded-lg border border-gray-200 p-4" data-testid="danger-zone">
      <h2 className="text-sm font-semibold text-gray-900">Delete or archive</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <button type="button" disabled={!actions.canDelete || busy} data-testid="delete-call"
            onClick={() => { if (window.confirm(DELETE_CONFIRM)) onDelete(); }}
            className="rounded-lg border border-[#B00000] px-3 py-1.5 text-sm font-semibold text-[#B00000] hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">Delete call</button>
          <p className="mt-1.5 text-[11px] text-gray-500">
            {actions.canDelete
              ? 'Only possible while nobody has applied and the call has not opened.'
              : actions.deleteProblem ?? deleteProblem(status as CallStatus, applicationsTotal) ?? 'This call cannot be deleted.'}
          </p>
        </div>
        <div>
          <button type="button" disabled={!actions.canArchive || busy} data-testid="archive-call"
            onClick={() => { if (window.confirm(ARCHIVE_CONFIRM)) onArchive(); }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">Archive call</button>
          <p className="mt-1.5 text-[11px] text-gray-500">
            {actions.canArchive ? 'Keeps everything, including applications, and takes the call out of the lists.' : 'Close the call before archiving it.'}
          </p>
        </div>
      </div>
    </section>
  );
}
