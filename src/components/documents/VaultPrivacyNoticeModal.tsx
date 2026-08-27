'use client';
// Prompt 403 §B / 404 §A — recurring Vault privacy reminder, one screen,
// no steps. Same portal + no-backdrop-close pattern as WelcomeModal.tsx
// (a stray click during page settle can't count as acknowledgement), but
// without WelcomeModal's step machinery — this popup never has more than
// one screen. Copy is approved verbatim (403) — not to be edited here.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function VaultPrivacyNoticeModal({ open, onGotIt }: { open: boolean; onGotIt: () => void }) {
  const [showDetail, setShowDetail] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) { setShowDetail(false); return; }
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    const focusables = card?.querySelectorAll<HTMLElement>('button, a, [tabindex]') ?? [];
    focusables[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !card) return;
      const list = Array.from(card.querySelectorAll<HTMLElement>('button, a, [tabindex]'));
      if (list.length === 0) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function close() {
    onGotIt();
    previouslyFocused.current?.focus();
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    // No onClick on the backdrop — deliberate, same reasoning as
    // WelcomeModal: only the "Got it" button counts as acknowledgement.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]">
      <div ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="vault-privacy-notice-title"
        className="w-full max-w-[440px] rounded-2xl bg-white p-7 shadow-2xl">
        <h2 id="vault-privacy-notice-title" className="mb-2 text-lg font-semibold text-gray-900">
          Your documents never leave this platform
        </h2>
        <p className="text-[14px] leading-[1.55] text-gray-700">
          Every file you upload to the Vault is checked for malware using only its digital fingerprint
          (a cryptographic hash) — never the file itself. The actual document is never uploaded,
          transmitted, or shared with any external service, at any point.
        </p>
        <button type="button" onClick={() => setShowDetail((s) => !s)}
          className="mt-2 text-[12.5px] font-medium text-[#0E7490] hover:underline">
          {showDetail ? 'Hide how this works' : 'How does this work?'}
        </button>
        {showDetail && (
          <p className="mt-2 rounded-xl bg-gray-50 p-3 text-[12.5px] leading-[1.55] text-gray-600">
            We compute a SHA-256 fingerprint of your file locally and check only that fingerprint against
            a threat database. Your file&apos;s actual content is validated locally too (its real format,
            not just the extension) — but the bytes themselves are never sent anywhere. If the fingerprint
            isn&apos;t recognized, the file is simply marked &quot;verified locally&quot; — that&apos;s the
            normal, expected outcome for a private document, not a limitation.
          </p>
        )}
        <div className="mt-5">
          <button onClick={close}
            className="rounded-lg bg-[#0E7490] px-4 py-2.5 text-[13.5px] font-medium text-white hover:bg-[#0c637b]">
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
