'use client';
// Prompt 611 §A.1 and §C — the account's NAME is how you go inside it. The
// "Open as viewer" button is gone from both Accounts tables; the function
// moved onto the name.
//
// §C's requirement, and it is the reason this is a <button> and not a styled
// <span> with an onClick: "o nome tem de parecer uma acção. Link ou botão a
// sério: acessível por teclado, com anel de foco, Enter a activar. Texto que
// muda de estado ao ser clicado mas se lê como texto morto é a pior
// combinação possível."
//
// §B — one click to start, one line, in. The reason is asked here and
// re-validated on the server (see the enter routes): a dialog is a courtesy,
// never the enforcement, and commitment 4 of the commitments page promises
// the founder a reason on every one of these lines.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { markViewerOrigin } from '@/components/DeveloperViewerFrame';
import { normalizeViewerReason, VIEWER_REASON_MAX } from '@/lib/viewer-reason';

export type ViewerSubjectKind = 'org' | 'investor_entity';

interface Props {
  kind: ViewerSubjectKind;
  /** orgs.id for a startup; catalog_entities.id for an investor firm. */
  id: string;
  name: string;
  /** Rendered after the name, outside the button (badges are not the action). */
  children?: React.ReactNode;
}

export function ViewerEntryName({ kind, id, name, children }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  // Prompt 886/877 — the confirmation is now about WHO is entering (one of the
  // authorised admin accounts), not a transparency notice to the customer.
  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then((b) => setAdminEmail(b?.user?.email ?? null)).catch(() => {});
  }, []);

  const check = normalizeViewerReason(reason);

  async function enter() {
    if (!check.ok) { setError(check.error); return; }
    setBusy(true); setError('');
    try {
      const endpoint = kind === 'org' ? '/api/backoffice/viewer/enter' : '/api/backoffice/viewer/enter-investor';
      const payload = kind === 'org' ? { orgId: id, reason: check.reason } : { entityId: id, reason: check.reason };
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!body.ok) { setError(body.error ?? 'Could not open the account.'); return; }
      if (kind === 'org') {
        markViewerOrigin();
        window.location.href = '/';
      } else {
        window.location.href = `/backoffice/investors/${id}/viewer`;
      }
    } catch {
      setError('Could not open the account.');
    } finally {
      setBusy(false);
    }
  }

  function close() { setOpen(false); setReason(''); setError(''); }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        title={kind === 'org' ? "Open this startup's workspace read-only — you'll be asked why (internal, not shown to them)" : "Open this firm's account read-only — you'll be asked why (internal, not shown to them)"}
        className="rounded text-left font-medium text-[#0E7490] underline decoration-transparent underline-offset-2 hover:decoration-inherit focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490] focus-visible:ring-offset-1">
        {name}
      </button>
      {children}
      {open && typeof document !== 'undefined' && createPortal(
        // Portal to document.body — this project's rule for any full-viewport
        // overlay, because a transformed/blurred ancestor silently becomes the
        // containing block and collapses a fixed overlay to its own box. The
        // back-office header has backdrop-blur, so this is not hypothetical.
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={close}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-gray-900">Open {name}</h2>
            {/* Prompt 886/877 — identity confirmation of the admin entering,
                not a transparency notice to the customer. The access is still
                logged internally (viewer_enter/viewer_exit are unchanged); it
                is simply no longer surfaced to the organisation being viewed. */}
            <p className="mt-1 text-xs text-gray-500">
              Opening <span className="font-medium text-gray-700">{name}</span>
              {adminEmail && <> as <span className="font-medium text-gray-700">{adminEmail}</span></>}.
              {' '}This access is logged internally and is not shown to the organisation.
            </p>
            <input ref={inputRef} value={reason} maxLength={VIEWER_REASON_MAX} autoComplete="off"
              onChange={(e) => { setReason(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && check.ok && !busy) enter(); if (e.key === 'Escape') close(); }}
              placeholder="Internal reason — e.g. support ticket 41, vault upload fails"
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            {error && <p className="mt-1.5 text-xs text-[#B00000]">{error}</p>}
            <div className="mt-3 flex gap-2">
              <button onClick={enter} disabled={!check.ok || busy}
                className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                {busy ? 'Opening…' : 'Open'}
              </button>
              <button onClick={close} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
