'use client';
// Prompt 341 §B — the blocking first-login acceptance gate. Deliberately
// OUTSIDE ONBOARDING_CONTENT and its 3-modal-per-account budget (see
// onboarding/content.ts / engine.test.ts): this is a legal requirement, not
// an onboarding nudge, and doesn't touch that engine or its test at all —
// useTermsGateStatus below is a plain, independent fetch, not a
// setCondition() call into OnboardingProvider.
//
// No close/escape/backdrop-dismiss by design (it's a contract, not a tip):
// the backdrop has no onClick handler, and Escape is swallowed while the
// gate is open. The only way out without accepting is the "Log out" link,
// reusing LogoutButton's own signOut()-then-redirect handler rather than a
// second copy of it.
//
// Mounted independently in each of the three role shells (shell.tsx,
// InvestorWorkspaceShell.tsx, backoffice/layout.tsx) since none of them
// share a common authenticated wrapper — see this component's own export of
// useTermsGateStatus, which shell.tsx also calls directly to defer
// WelcomeModal until this gate is known to be clear (T&C must show first if
// both would fire on the same first login).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { TermsDocument } from './TermsDocument';
import { LogoutButton } from '@/components/workspace-shell/LogoutButton';
import { TERMS_VERSION } from '@/lib/terms';

export function useTermsGateStatus(): boolean | null {
  const [needsAcceptance, setNeedsAcceptance] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/terms/status').then((r) => r.json())
      .then((d) => { if (!cancelled) setNeedsAcceptance(!!d.needsAcceptance); })
      .catch(() => { if (!cancelled) setNeedsAcceptance(false); });
    return () => { cancelled = true; };
  }, []);
  return needsAcceptance;
}

export function TermsGateModal() {
  const needsAcceptance = useTermsGateStatus();
  const [checked, setChecked] = useState(false);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!needsAcceptance) return;
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') e.preventDefault(); }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [needsAcceptance]);

  async function accept() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/terms/accept', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error ?? 'Could not record your acceptance — please try again.'); return; }
      // Reload rather than lift state: every mounted useTermsGateStatus()
      // (this modal, the host shell's own WelcomeModal gate) re-checks fresh
      // in one pass, and the gate itself unmounts once its own fetch comes
      // back false — same "reload settles everything" shape as elsewhere in
      // this codebase (e.g. TermsGateModal's own status re-fetch on mount).
      window.location.reload();
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!needsAcceptance || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="terms-gate-title"
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        {reading ? (
          <div className="flex max-h-[85vh] flex-col">
            <div className="flex items-center justify-between border-b border-gray-100 p-4">
              <h2 className="text-sm font-semibold text-gray-900">Terms & Conditions — Version {TERMS_VERSION}</h2>
              <button onClick={() => setReading(false)} className="text-xs font-medium text-[#0E7490] hover:underline">
                Back
              </button>
            </div>
            <div className="overflow-y-auto p-5">
              <TermsDocument />
            </div>
          </div>
        ) : (
          <div className="p-6">
            <h2 id="terms-gate-title" className="text-base font-semibold text-gray-900">Before you continue</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Use of Sherlock Deal is governed by our{' '}
              <button onClick={() => setReading(true)} className="font-medium text-[#0E7490] hover:underline">
                Terms &amp; Conditions
              </button>. Please read and accept them to proceed.
            </p>
            <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />
              I have read and accept the Terms &amp; Conditions
            </label>
            {error && <p className="mt-2 text-xs font-medium text-[#B00000]">{error}</p>}
            <button disabled={!checked || busy} onClick={accept}
              className="mt-4 w-full rounded-lg bg-[#0E7490] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0c637b] disabled:opacity-40">
              {busy ? 'Saving…' : error ? 'Retry' : 'Accept and continue'}
            </button>
            <div className="mt-3 text-center">
              <LogoutButton className="border-0 bg-transparent px-0 text-gray-400" />
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
