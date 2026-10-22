'use client';
// Prompt 918 (Adenda 2, C) — the read-only copy of an application whose call was deleted: who cancelled it, the day it goes, the submitted answers, a Download beside each file and "Print / save as PDF".
// A DRAFT has nothing to take away (it was never submitted), so only a submitted application opens here; a draft says so.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { applicantApi } from '@/lib/calls/applicant/client';
import type { ApplicationState } from '@/lib/calls/applicant/store';
import { formatDayInZone } from '@/lib/calls/tz';
import { ApplicationForm } from './ApplicationForm';

type Load = { kind: 'loading' } | { kind: 'problem'; text: string } | { kind: 'ready'; state: ApplicationState; page: number };

export function CancelledApplication({ applicationId }: { applicationId: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    void applicantApi.get(applicationId).then((r) => {
      if (!alive) return;
      setLoad(r.ok ? { kind: 'ready', state: r.body.state, page: r.body.page } : { kind: 'problem', text: r.body.error ?? 'We could not open this application. It may already have been removed.' });
    });
    return () => { alive = false; };
  }, [applicationId]);

  return (
    <div data-testid="cancelled-application">
      <Link href="/calls" className="text-xs font-semibold text-[#0E7490] hover:underline print:hidden">← Calls</Link>
      {load.kind === 'loading' && <p className="mt-4 text-sm text-gray-400">Opening your application…</p>}
      {load.kind === 'problem' && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-[#B00000]" data-testid="cancelled-problem">{load.text}</p>}
      {load.kind === 'ready' && (
        <>
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4" data-testid="cancelled-banner">
            <p className="text-sm font-semibold text-red-900">{load.state.call.promoter} cancelled the call {load.state.call.name}.</p>
            <p className="mt-1 text-sm text-red-900">
              {load.state.call.deletedPurgeAfter
                ? <>Your application will be deleted on <b>{formatDayInZone(load.state.call.deletedPurgeAfter, load.state.call.timezone)}</b>. Until then you can read it and download your files.</>
                : <>Your application will be deleted soon. Until then you can read it and download your files.</>}
            </p>
            <button type="button" onClick={() => window.print()} data-testid="print-application"
              className="mt-3 min-h-[44px] rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-900 hover:bg-red-100 print:hidden">Print / save as PDF</button>
          </div>
          {load.state.application.status !== 'submitted'
            ? <p className="mt-4 text-sm text-gray-600" data-testid="cancelled-draft">This application was never submitted, so there is nothing to download. It will be deleted with the call.</p>
            : <div className="mt-5"><ApplicationForm key={load.state.application.id} initial={load.state} initialPage={load.page} onSubmitted={() => {}} /></div>}
        </>
      )}
    </div>
  );
}
