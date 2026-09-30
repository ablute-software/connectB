'use client';
// Prompt 421 §D — starts small, on purpose: one real notification
// preference. The list grows later — this never fakes a rules engine that
// doesn't exist yet.
//
// Prompt 747 §A — the Evaluation Tools intro reactivation control that used
// to live here (a card that did nothing whenever the intro wasn't muted —
// "nothing to reactivate") moved to EvaluationToolsPanel.tsx itself, right
// next to the intro it reactivates, and only renders when there is
// something to actually do (evaluationToolsIntroMuted === true). No card
// here for it anymore — see this prompt's own DECISIONS.md entry.
import { useState } from 'react';

export function AutomationsTab({ initialNotifyNewEligibleStartup }: { initialNotifyNewEligibleStartup: boolean }) {
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
        <h2 className="text-sm font-semibold text-gray-900">Notifications</h2>
        <label className="mt-2 flex items-center justify-between gap-3 text-sm text-gray-700">
          {/* Prompt 747 §B — says what it actually does now: a real daily
              digest, only when there's something new, not a vague promise. */}
          <span>Email me when new startups enter my pipeline (one digest a day, only when there&apos;s something new)</span>
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
