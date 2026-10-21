'use client';
// Prompt 918 (Adenda 2, B) — what a person sees on a call's link when the platform shows them a startup's workspace READ-ONLY: a Developer Viewer session (a platform account looking inside a
// startup, 4 hours at most). The read-only itself is right — nothing may be started or changed on somebody else's behalf — but the screen used to say only that, with no button: a dead end. It now
// says who the person is, what they are looking at and why it cannot apply, and gives the ways out: leave the viewer and continue as themselves, or sign out and use another account. "Tell us" (the
// platform's report widget) is one click away too.
import { useState } from 'react';
import { browserClient } from '@/lib/supabase';
import { OPEN_REPORT_EVENT } from '@/lib/report-problem-event';

export function readOnlyMessage(email: string | null | undefined, startupName: string | null | undefined): string {
  const who = email ? `You are signed in as ${email}` : 'You are signed in';
  const where = startupName ? `viewing “${startupName}” in Developer Viewer, which is read-only` : 'in Developer Viewer, which is read-only';
  return `${who} and ${where}. Applications can only be started or changed by the startup’s own owner or admin.`;
}

async function leaveViewer(): Promise<boolean> {
  try { const r = await fetch('/api/backoffice/viewer/exit', { method: 'POST' }); return r.ok; } catch { return false; }
}

export function ReadOnlyNotice({ email, startupName, onLeft }: { email?: string | null; startupName?: string | null; onLeft: () => void }) {
  const [busy, setBusy] = useState<'exit' | 'signout' | null>(null);
  const [problem, setProblem] = useState('');

  async function exit() {
    setBusy('exit'); setProblem('');
    if (await leaveViewer()) onLeft();
    else { setBusy(null); setProblem('We could not leave Developer Viewer. Please try again.'); }
  }
  async function signOut() {
    setBusy('signout'); setProblem('');
    await leaveViewer();                                   // the viewer cookie must not outlive the account
    try { await browserClient().auth.signOut(); } catch { /* the page reload below shows the real state either way */ }
    onLeft();
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" data-testid="viewer-note" role="status">
      <p className="text-sm text-amber-950" data-testid="viewer-note-text">{readOnlyMessage(email, startupName)}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" disabled={busy !== null} onClick={() => void exit()} data-testid="viewer-exit"
          className="min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-60">{busy === 'exit' ? 'Leaving…' : 'Leave Developer Viewer and continue as myself'}</button>
        <button type="button" disabled={busy !== null} onClick={() => void signOut()} data-testid="viewer-signout"
          className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60">{busy === 'signout' ? 'Signing out…' : 'Sign out and use another account'}</button>
        <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_REPORT_EVENT))} data-testid="viewer-report"
          className="min-h-[44px] px-2 text-sm font-medium text-[#0E7490] hover:underline">Report a problem</button>
      </div>
      {problem && <p role="alert" className="mt-2 text-xs text-[#B00000]">{problem}</p>}
    </div>
  );
}
