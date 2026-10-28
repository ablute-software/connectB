'use client';
// Prompt 918 (I3) — "Report a problem" at the foot of every page of the applicant's journey (spec §14.5), including the page with the registration and the code. It opens a small form IN the page (never a
// browser dialog), sends the report to the platform's support with URGENT priority and the call's context, and confirms on screen. It submits nothing and changes no deadline — it says so.
import { useState } from 'react';

const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm';

export function ReportProblem({ token, page, signedIn }: { token: string; page: string; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  async function send() {
    setError('');
    if (message.trim().length < 10) { setError('Please tell us a little more (at least 10 characters).'); return; }
    setState('sending');
    try {
      const res = await fetch(`/api/calls/public/${encodeURIComponent(token)}/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, email: signedIn ? undefined : email, page }) });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) { setState('idle'); setError(d.error ?? 'We could not send your report. Please try again.'); return; }
      setState('sent');
    } catch { setState('idle'); setError('We could not reach the server. Check your connection and try again.'); }
  }

  return (
    <div className="mt-6 border-t border-gray-100 pt-3 text-xs text-gray-500" data-testid="report-problem">
      {state === 'sent' ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900" data-testid="report-sent">Thank you. Your report reached our team and was marked urgent. It does not submit anything and does not change any deadline.</p>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className="min-h-[44px] text-left font-medium text-[#0E7490] hover:underline sm:min-h-0" data-testid="report-open">Something is not working? Report a problem</button>
      ) : (
        <div className="space-y-2" role="group" aria-label="Report a problem">
          <label className="block font-semibold text-gray-700" htmlFor="report-message">What happened?</label>
          <textarea id="report-message" rows={4} maxLength={3000} className={INPUT} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell us what you were doing and what went wrong." data-testid="report-message" />
          {!signedIn && (
            <>
              <label className="block font-semibold text-gray-700" htmlFor="report-email">Your email, so we can answer</label>
              <input id="report-email" type="email" autoComplete="email" className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} data-testid="report-email" />
            </>
          )}
          <p className="text-[11px] text-gray-400">It goes to our team as urgent. It does not submit your application and does not change any deadline. Please never write a password.</p>
          {error && <p role="alert" className="text-[#B00000]" data-testid="report-error">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={state === 'sending'} onClick={() => void send()} className="min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40 sm:min-h-0" data-testid="report-send">{state === 'sending' ? 'Sending…' : 'Send report'}</button>
            <button type="button" disabled={state === 'sending'} onClick={() => { setOpen(false); setError(''); }} className="min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 sm:min-h-0" data-testid="report-cancel">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
