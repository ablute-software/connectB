'use client';
// Prompt 907 — what a signed-in applicant with a startup sees below the call's header: their application (Prompt 907 I2 and I3 fill this
// in: the form, the autosave, the submission). For I1 it states who is applying and whether there is already something to continue.
import type { PublicCallInfo } from './CallHeader';

export interface CallSession {
  authenticated: boolean;
  hasStartup: boolean;
  readOnly?: boolean;
  email?: string | null;
  startupName?: string | null;
  application?: { id: string; status: 'draft' | 'submitted'; reference: string | null; lastPage: number | null } | null;
  submittedCount?: number;
  allowMultiple?: boolean;
}

export function ApplicationArea({ call, session }: { token: string; call: PublicCallInfo; session: CallSession; onChanged: () => void }) {
  const app = session.application ?? null;
  return (
    <section data-testid="application-area" className="rounded-xl border border-gray-200 p-4">
      <p className="text-sm text-gray-600">
        Applying as <b className="text-gray-900">{session.startupName ?? 'your startup'}</b>{session.email ? <> · {session.email}</> : null}
      </p>
      {call.phase !== 'open' && !app && <p className="mt-2 text-sm text-gray-500">There is no application to continue.</p>}
      {app?.status === 'draft' && <p className="mt-2 text-sm text-gray-700" data-testid="has-draft">You have an application in progress{app.lastPage ? ` (page ${app.lastPage})` : ''}.</p>}
      {app?.status === 'submitted' && <p className="mt-2 text-sm text-gray-700" data-testid="has-submitted">Your application was submitted.</p>}
    </section>
  );
}
