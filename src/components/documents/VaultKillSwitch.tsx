'use client';
// Prompt 278 §4 — the Vault kill switch: a single, org-wide "no investor
// can see any document or folder right now" control. The server-side gate
// (vaultFrozenForOrg, data-room-server.ts) is what actually enforces this on
// every investor-facing route; this component is just the founder-facing
// read/write of orgs.vault_access_frozen_at via the same updateOrg() store
// action every other org toggle already uses (RoundCard.tsx, ReviewPanel.tsx
// swot/roadmap toggles) — no new API route needed, same owner/admin
// org_editing permission gate as those toggles (enforced in /api/org/update,
// not re-checked here).
//
// Activating goes through a real modal, not window.confirm: this is
// org-wide, every investor at once, not a single row — same "serious step"
// bar as ReportFraudModal.tsx. Deactivating uses window.confirm, since
// restoring access is the undo/safe direction — same light-confirm
// precedent as HardFilterBanner's "Not a fit" (Prompt 277).
//
// The banner is `position: fixed`, portal-rendered to document.body — same
// containing-block rule as every other fixed-position element in this app
// (CLAUDE.md): WorkspaceHeader's backdrop-blur would otherwise silently
// become its containing block and collapse it.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';

export function VaultKillSwitch() {
  const { db, updateOrg } = useStore();
  const frozenAt = db.org.vault_access_frozen_at ?? null;
  const [confirming, setConfirming] = useState(false);

  function unfreeze() {
    if (!window.confirm(
      'Restore Vault access for every investor with an active grant? Nothing was lost while it was off — this just turns their existing access back on.',
    )) return;
    updateOrg({ vault_access_frozen_at: null });
  }

  function freeze() {
    updateOrg({ vault_access_frozen_at: new Date().toISOString() });
    setConfirming(false);
  }

  return (
    <>
      {frozenAt && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-x-0 top-0 z-[70] flex flex-wrap items-center justify-center gap-2 bg-[#B00000] px-4 py-2 text-center text-sm font-medium text-white shadow-lg">
          <span>🚨 Vault suspended — no investor has access to any document or folder right now (since {new Date(frozenAt).toLocaleString()}).</span>
          <button onClick={unfreeze} className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30">
            Restore access
          </button>
        </div>,
        document.body,
      )}

      {frozenAt ? (
        <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-[#B00000]">🚨 Vault suspended</span>
      ) : (
        <button onClick={() => setConfirming(true)}
          className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">
          Close vault for everyone
        </button>
      )}

      {confirming && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') setConfirming(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="vault-kill-switch-title"
            className="w-full max-w-[480px] rounded-2xl bg-white p-6 shadow-2xl">
            <h2 id="vault-kill-switch-title" className="text-lg font-semibold text-gray-900">🚨 Close the Vault for everyone?</h2>
            <p className="mt-2 text-sm text-gray-500">
              Every investor with a grant to any document or folder loses access immediately — org-wide, not one at a time.
              Nothing is deleted or revoked: their grants stay exactly as they are, and turning this back off restores access instantly.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirming(false)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={freeze}
                className="rounded-lg bg-[#B00000] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#8f0000]">
                Close vault now
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
