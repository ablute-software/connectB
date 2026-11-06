'use client';
// Prompt 929 (B) — the applicant's choice about the tips from Sherlock Deal. A plain checkbox on the account: "I don't want to receive feedback from Sherlock Deal about my evaluations". It never affects the
// replies of the organisations (those are always sent). Saves at once; says what happened in the page.
import { useEffect, useState } from 'react';

export function TipsPreference({ className = '' }: { className?: string }) {
  const [optOut, setOptOut] = useState<boolean | null>(null);
  const [saved, setSaved] = useState('');
  useEffect(() => {
    let live = true;
    fetch('/api/calls/apply/preferences', { cache: 'no-store' }).then((r) => r.json()).then((d) => { if (live && d?.ok) setOptOut(d.tipsOptOut === true); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  if (optOut === null) return null;
  const change = async (value: boolean) => {
    setOptOut(value); setSaved('');
    const r = await fetch('/api/calls/apply/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipsOptOut: value }) }).catch(() => null);
    if (r && r.ok) setSaved(value ? 'Saved. You will not receive them.' : 'Saved. You may receive them.');
    else { setOptOut(!value); setSaved('This could not be saved. Try again.'); }
  };
  return (
    <section className={`min-w-0 rounded-xl border border-gray-200 bg-white p-4 ${className}`} data-testid="tips-preference">
      <h2 className="text-sm font-semibold text-gray-900">Tips from Sherlock Deal</h2>
      <p className="mt-1 text-xs text-gray-500">If an organisation allows it and you were not selected, Sherlock Deal may send you a separate email with up to 3 general tips to improve your next application. The organisation’s own reply is never affected.</p>
      <label className="mt-3 flex items-start gap-2 text-sm text-gray-800">
        <input type="checkbox" className="mt-1" checked={optOut} onChange={(e) => { void change(e.target.checked); }} data-testid="tips-opt-out" />
        <span className="min-w-0">I don’t want to receive feedback from Sherlock Deal about my evaluations.</span>
      </label>
      <p className="mt-2 min-h-[1rem] text-xs text-gray-500" role="status" data-testid="tips-preference-status">{saved}</p>
    </section>
  );
}
