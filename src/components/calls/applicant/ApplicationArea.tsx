'use client';
// Prompt 907 — what a signed-in applicant with a startup sees below the call's header: their application. It asks the server to open it
// (create the draft pre-filled once, or resume it where it was left — the same call also records that this startup reached the call by
// its link), then shows the form, or — once submitted — a read-only copy with its confirmation. With several applications allowed per
// startup, "Start another application" opens a new one; otherwise the application is the one per startup (or per company) the call allows.
import { useCallback, useEffect, useRef, useState } from 'react';
import { applicantApi } from '@/lib/calls/applicant/client';
import type { ApplicationState } from '@/lib/calls/applicant/store';
import type { PublicCallInfo } from './CallHeader';
import { ApplicationForm } from './ApplicationForm';
import { ApplicantResult } from './ApplicantResult';
import { ReadOnlyNotice } from './ReadOnlyNotice';
import { TeamNotice } from './TeamNotice';

export interface CallSession {
  authenticated: boolean;
  hasStartup: boolean;
  readOnly?: boolean;
  /** Prompt 918 (Adenda 3): the person is on this call's team — they never apply to it. */
  onTeam?: boolean;
  email?: string | null;
  startupName?: string | null;
  application?: { id: string; status: 'draft' | 'submitted'; reference: string | null; lastPage: number | null } | null;
  submittedCount?: number;
  allowMultiple?: boolean;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'problem'; code?: string; text: string }
  | { kind: 'ready'; state: ApplicationState; page: number };

export function ApplicationArea({ token, call, session, onChanged }: { token: string; call: PublicCallInfo; session: CallSession; onChanged: () => void }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [justSubmitted, setJustSubmitted] = useState<{ reference: string | null; submittedAt: string } | null>(null);

  const open = useCallback(async (startNew = false) => {
    setLoad({ kind: 'loading' });
    const r = await applicantApi.start(token, startNew);
    if (r.ok) { setLoad({ kind: 'ready', state: r.body.state, page: r.body.page }); return; }
    setLoad({ kind: 'problem', code: r.body.code, text: r.body.error ?? 'We could not open your application. Please try again.' });
  }, [token]);

  // Read one application (a submitted one to look at): never opens a new draft.
  const view = useCallback(async (id: string) => {
    const r = await applicantApi.get(id);
    if (r.ok) setLoad({ kind: 'ready', state: r.body.state, page: r.body.page });
    else setLoad({ kind: 'problem', code: r.body.code, text: r.body.error ?? 'We could not open your application. Please try again.' });
  }, []);

  // Once, when the area appears. A submitted application is only ever READ here: opening is what creates a draft, and with several
  // applications allowed per startup, "open" on a startup with none in progress would start a new one nobody asked for.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (session.application?.status === 'submitted') { void view(session.application.id); return; }
    // A call that is not open and where this startup has nothing to continue has nothing to show below the header.
    if (call.phase !== 'open' && !session.application) { setLoad({ kind: 'none' }); return; }
    void open(false);
  }, [call.phase, session.application, open, view]);

  if (session.onTeam) return <TeamNotice />;
  // A Developer Viewer session: read-only is right, but never a dead end (Prompt 918, Adenda 2, B).
  if (session.readOnly) return <ReadOnlyNotice email={session.email} startupName={session.startupName} onLeft={() => window.location.reload()} />;

  return (
    <div data-testid="application-area">
      <p className="mb-3 text-sm text-gray-600">
        Applying as <b className="text-gray-900">{session.startupName ?? 'your startup'}</b>{session.email ? <> · {session.email}</> : null}
      </p>
      {load.kind === 'loading' && <p className="text-sm text-gray-400">Opening your application…</p>}
      {load.kind === 'none' && <p className="text-sm text-gray-500">There is no application to continue.</p>}
      {load.kind === 'problem' && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-[#B00000]" data-testid="application-problem" data-code={load.code}>{load.text}</p>
      )}
      {load.kind === 'ready' && justSubmitted && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4" role="status" data-testid="submission-confirmation">
          <h2 className="text-base font-semibold text-emerald-900">Application submitted</h2>
          <p className="mt-1 text-sm text-emerald-900">
            We received it{justSubmitted.reference ? <> with the reference <b className="font-mono" data-testid="confirmation-reference">{justSubmitted.reference}</b></> : null}.
            We also sent you a confirmation by email. You can read your application below, but it can no longer be changed.
          </p>
        </div>
      )}
      {load.kind === 'ready' && load.state.application.status === 'submitted' && <ApplicantResult applicationId={load.state.application.id} timezone={call.timezone} />}
      {load.kind === 'ready' && (
        <>
          <ApplicationForm key={`${load.state.application.id}-${load.state.application.status}`} initial={load.state} initialPage={load.page}
            onSubmitted={async (s) => { setJustSubmitted(s); await view(load.state.application.id); onChanged(); }} />
          {load.state.application.status === 'submitted' && session.allowMultiple && call.phase === 'open' && (
            <button type="button" onClick={() => void open(true)} data-testid="start-another"
              className="mt-4 rounded-lg border border-[#0E7490] px-3 py-1.5 text-sm font-medium text-[#0E7490] hover:bg-[#E8F4F8]">Start another application</button>
          )}
        </>
      )}
    </div>
  );
}
