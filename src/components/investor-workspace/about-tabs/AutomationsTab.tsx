'use client';
// Prompt 421 §D — starts small, on purpose: one control to reactivate the
// Evaluation Tools intro pamphlet (Prompt 420), one real notification
// preference. The list grows later — this never fakes a rules engine that
// doesn't exist yet.
import { useState } from 'react';
import { useOnboarding } from '@/lib/onboarding/OnboardingProvider';

export function AutomationsTab({ initialNotifyNewEligibleStartup }: { initialNotifyNewEligibleStartup: boolean }) {
  // Prompt 421 §D.1 — InvestorProfilePanel and EvaluationToolsPanel are
  // sibling tabs inside the SAME InvestorWorkspaceShell <OnboardingProvider>
  // (confirmed: that provider wraps every tab, not just Evaluation Tools),
  // so this reads/writes the exact same evaluationToolsIntroMuted state
  // that panel's own pamphlet checks — no new API route needed.
  const { loaded, evaluationToolsIntroMuted, setEvaluationToolsIntroMuted } = useOnboarding();

  const [notify, setNotify] = useState(initialNotifyNewEligibleStartup);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyErr, setNotifyErr] = useState('');

  async function toggleNotify() {
    const next = !notify;
    setNotify(next); setNotifyBusy(true); setNotifyErr('');
    try {
      const res = await fetch('/api/portal/investor-profile/notify-preference', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: next }),
      });
      const body = await res.json();
      if (!body.ok) { setNotify(!next); setNotifyErr(body.error ?? 'Could not save.'); }
    } catch {
      setNotify(!next); setNotifyErr('Network error — please try again.');
    } finally { setNotifyBusy(false); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Evaluation Tools introduction</h2>
        {!loaded ? (
          <p className="mt-1 text-xs text-gray-400">Loading…</p>
        ) : evaluationToolsIntroMuted ? (
          <>
            <p className="mt-1 text-xs text-gray-500">You told Watson not to show the tool introductions anymore.</p>
            <button onClick={() => setEvaluationToolsIntroMuted(false)}
              className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Show tool introductions again
            </button>
          </>
        ) : (
          <p className="mt-1 text-xs text-gray-500">The Evaluation Tools intro still shows on first login — nothing to reactivate.</p>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Notifications</h2>
        <label className="mt-2 flex items-center justify-between gap-3 text-sm text-gray-700">
          <span>Notify me when a new startup enters my eligible pipeline</span>
          <button role="switch" aria-checked={notify} onClick={toggleNotify} disabled={notifyBusy}
            className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-40 ${notify ? 'bg-[#0E7490]' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${notify ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
          </button>
        </label>
        {notifyErr && <p className="mt-1.5 text-[11px] text-[#B00000]">{notifyErr}</p>}
        <p className="mt-2 text-[11px] text-gray-400">More automations coming later — this list starts small on purpose.</p>
      </div>
    </div>
  );
}
