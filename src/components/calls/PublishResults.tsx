'use client';
// Prompt 924 (Etapa 4, I2) — Results → Publish. For whoever may "Publish results": what will go out and to how many people, what still blocks it, the messages as they are, a test email to yourself, publishing
// now or at a time (the name of the call typed in the page to confirm — never a browser dialog), and, once it is out, the state of every email with "Send again". All the applications of a phase go out together.
import { useCallback, useEffect, useState } from 'react';
import { RichText } from '@/components/RichText';
import { PLACEHOLDERS, RESULT_KEYS, SEND_LABELS, confirmationMatches, type PublicationView, type ResultKey, type SendStatus } from '@/lib/calls/results';
import { formatInZone, wallToUtcIso } from '@/lib/calls/tz';
import { callsApi } from './api';

const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50';
const BTN = 'min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';
const PRIMARY = 'min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40';
const CARD = 'min-w-0 rounded-xl border border-gray-200 bg-white p-4';
const TONE: Record<SendStatus, string> = { queued: 'bg-amber-50 text-amber-900', sent: 'bg-emerald-50 text-emerald-900', bounced: 'bg-red-50 text-red-900', failed: 'bg-red-50 text-red-900' };

export function PublishResults({ callId, onOpenPrepare }: { callId: string; onOpenPrepare?: () => void }) {
  const [view, setView] = useState<PublicationView | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [mode, setMode] = useState<'now' | 'later'>('now');
  const [when, setWhen] = useState('');
  const [typed, setTyped] = useState('');
  const [filter, setFilter] = useState<'all' | SendStatus>('all');

  const load = useCallback(async () => {
    const r = await callsApi.publication(callId);
    if (!r.ok) { setError(r.body.error ?? 'Could not load the publication.'); return; }
    setError(''); setView(r.body);
  }, [callId]);
  useEffect(() => { void load(); }, [load]);

  async function run<T extends Partial<PublicationView>>(label: string, fn: () => Promise<{ ok: boolean; body: T & { error?: string } }>, done: (b: T) => string) {
    setBusy(label); setError(''); setNotice('');
    const r = await fn();
    setBusy('');
    if (!r.ok) { setError(r.body.error ?? 'Something went wrong. Please try again.'); return; }
    if ('ok' in r.body && (r.body as { phase?: unknown }).phase) setView(r.body as unknown as PublicationView);
    setNotice(done(r.body)); setTyped('');
  }

  if (!view) return error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-[#B00000]" data-testid="publish-error">{error}</p> : <p className="text-sm text-gray-400" data-testid="publish-loading">Loading…</p>;

  const published = view.batch?.status === 'published';
  const scheduled = view.batch?.status === 'scheduled';
  const blockers = view.blockers.filter((b) => b.code !== 'already_published');
  const atIso = mode === 'later' && when ? wallToUtcIso(when, view.timezone) : null;
  const confirmed = confirmationMatches(typed, view.callName);
  const canPublish = !published && !scheduled && blockers.length === 0 && confirmed && !busy && (mode === 'now' || !!atIso);
  const n = view.summary.emails;
  const rows = view.sends.rows.filter((s) => filter === 'all' || s.status === filter);

  return (
    <div className="min-w-0 space-y-4" data-testid="publish-results">
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-[#B00000]" data-testid="publish-error">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="publish-notice">{notice}</p>}

      {published && view.batch && (
        <section className={`${CARD} border-emerald-200 bg-emerald-50`} data-testid="published-box">
          <h2 className="text-sm font-semibold text-emerald-900">Published</h2>
          <p className="mt-1 text-sm text-emerald-900">{view.batch.total} applicant{view.batch.total === 1 ? '' : 's'} were told their result on {formatInZone(view.batch.publishedAt, view.timezone)}{view.phase.name && view.history.length > 1 ? ` (${view.phase.name})` : ''}. The decisions of this phase are now fixed.</p>
        </section>
      )}
      {scheduled && view.batch && (
        <section className={`${CARD} border-sky-200 bg-sky-50`} data-testid="scheduled-box">
          <h2 className="text-sm font-semibold text-sky-900">Scheduled</h2>
          <p className="mt-1 text-sm text-sky-900">The results will be published on {formatInZone(view.batch.scheduledAt, view.timezone)} ({view.timezone}). Until then nothing can be changed. It goes out the first time somebody opens the app after that time, or at the next daily run.</p>
          <button type="button" className={`${BTN} mt-2`} disabled={!!busy} data-testid="cancel-schedule" onClick={() => void run('cancel', () => callsApi.publicationCancel(callId), () => 'The schedule was cancelled.')}>Cancel the schedule</button>
        </section>
      )}

      {!published && (
        <>
          <section className={CARD} data-testid="publish-summary">
            <h2 className="text-sm font-semibold text-gray-900">What will go out</h2>
            <p className="mt-1 text-sm text-gray-700">{n} email{n === 1 ? '' : 's'}{view.phase.name && view.phase.hasNext ? ` for “${view.phase.name}”` : ''}, all at once: {RESULT_KEYS.map((k) => `${view.summary.counts[k]} ${view.labels[k]}`).join(' · ')}. Each applicant also gets it in the app, under My applications.</p>
            {blockers.map((b) => <p key={b.code} role="alert" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid={`blocker-${b.code}`}>{b.text}{b.code === 'pending' || b.code === 'missing_grade' || b.code === 'unknown_fields' ? ' ' : ''}{(b.code === 'pending' || b.code === 'missing_grade' || b.code === 'unknown_fields') && onOpenPrepare && <button type="button" className="underline" onClick={onOpenPrepare}>Go to Prepare</button>}</p>)}
          </section>

          <section className={CARD} data-testid="publish-messages">
            <h2 className="text-sm font-semibold text-gray-900">The messages</h2>
            <p className="mt-1 text-xs text-gray-500">As they will go out; each applicant’s own name and details fill the fields in. Change them in Prepare.</p>
            <div className="mt-3 space-y-4">
              {RESULT_KEYS.map((k: ResultKey) => (
                <div key={k} className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 p-3" data-testid={`message-${k}`}>
                  <p className="min-w-0 text-xs text-gray-500">Subject · {view.summary.counts[k]} applicant{view.summary.counts[k] === 1 ? '' : 's'}</p>
                  <p className="min-w-0 text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">{view.subjects[k]}</p>
                  <RichText value={view.messages[k]} className="mt-2 text-sm text-gray-800" mergeFields={[...PLACEHOLDERS]} />
                </div>
              ))}
            </div>
            <button type="button" className={`${BTN} mt-3`} disabled={!!busy} data-testid="send-test" onClick={() => void run('test', () => callsApi.publicationTest(callId) as never, (b) => `Sent ${(b as unknown as { sent: number }).sent} test emails to ${(b as unknown as { to: string }).to}. They carry example data and go to nobody else.`)}>{busy === 'test' ? 'Sending…' : 'Send me a test'}</button>
          </section>
        </>
      )}

      {!published && !scheduled && (
        <section className={CARD} data-testid="publish-box">
          <h2 className="text-sm font-semibold text-gray-900">Publish</h2>
          <div role="radiogroup" aria-label="When" className="mt-2 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="when" checked={mode === 'now'} onChange={() => setMode('now')} data-testid="mode-now" /> Publish now</label>
            <label className="flex items-center gap-2"><input type="radio" name="when" checked={mode === 'later'} onChange={() => setMode('later')} data-testid="mode-later" /> Schedule</label>
          </div>
          {mode === 'later' && (
            <div className="mt-2">
              <label htmlFor="pub-when" className="block text-xs font-medium text-gray-600">Date and time ({view.timezone})</label>
              <input id="pub-when" type="datetime-local" autoComplete="off" className={`${INPUT} sm:!w-64`} value={when} onChange={(e) => setWhen(e.target.value)} data-testid="schedule-at" />
            </div>
          )}
          <p className="mt-3 text-sm font-medium text-gray-900" data-testid="confirm-sentence">
            {mode === 'now' ? `Publish results for ${n} applicant${n === 1 ? '' : 's'}? This cannot be undone.` : `Schedule the results for ${n} applicant${n === 1 ? '' : 's'}${atIso ? ` on ${formatInZone(atIso, view.timezone)}` : ''}? Nothing is sent until then.`}
          </p>
          <label htmlFor="pub-confirm" className="mt-2 block text-xs font-medium text-gray-600">Type the name of the call to confirm: <span className="font-semibold text-gray-800 [overflow-wrap:anywhere]">{view.callName}</span></label>
          <input id="pub-confirm" autoComplete="off" className={INPUT} value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="confirm-name" />
          <button type="button" className={`${PRIMARY} mt-3`} disabled={!canPublish} data-testid="publish-button"
            onClick={() => void (mode === 'now'
              ? run('publish', () => callsApi.publicationPublish(callId, typed), (b) => `Published: ${(b as unknown as { published: number }).published} applicants were told their result.`)
              : run('schedule', () => callsApi.publicationSchedule(callId, atIso ?? '', typed), () => `Scheduled for ${formatInZone(atIso, view.timezone)}.`))}>
            {busy === 'publish' || busy === 'schedule' ? 'Working…' : mode === 'now' ? 'Publish results' : 'Schedule publication'}
          </button>
        </section>
      )}

      {view.sends.rows.length > 0 && (
        <section className={CARD} data-testid="sends">
          <h2 className="text-sm font-semibold text-gray-900">The emails</h2>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-600" data-testid="send-counts">
            {(Object.keys(view.sends.counts) as SendStatus[]).map((s) => <span key={s}>{SEND_LABELS[s]}: <b>{view.sends.counts[s]}</b></span>)}
          </p>
          <p className="mt-1 text-xs text-gray-500">A result is always in the app, whatever happens to its email. A temporary failure is tried again by itself.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor="send-filter" className="text-xs text-gray-600">Show</label>
            <select id="send-filter" className={`${INPUT} !w-40`} value={filter} onChange={(e) => setFilter(e.target.value as 'all' | SendStatus)} data-testid="send-filter">
              <option value="all">All</option>
              {(Object.keys(SEND_LABELS) as SendStatus[]).map((s) => <option key={s} value={s}>{SEND_LABELS[s]}</option>)}
            </select>
            {view.sends.counts.queued > 0 && <button type="button" className={BTN} disabled={!!busy} data-testid="send-waiting" onClick={() => void run('waiting', () => callsApi.publicationSendWaiting(callId), () => 'The waiting emails were sent as far as possible.')}>{busy === 'waiting' ? 'Sending…' : `Send the ${view.sends.counts.queued} waiting email${view.sends.counts.queued === 1 ? '' : 's'} now`}</button>}
          </div>
          <ul className="mt-3 divide-y divide-gray-100" data-testid="send-rows">
            {rows.map((s) => (
              <li key={s.sendId} className="flex min-w-0 flex-wrap items-center gap-2 py-2" data-testid="send-row" data-status={s.status}>
                <span className="min-w-0 flex-1 text-xs text-gray-800 [overflow-wrap:anywhere]">{s.startupName ?? s.reference ?? 'Application'}{s.reference && s.startupName ? ` (${s.reference})` : ''} — {s.label}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE[s.status]}`} data-testid="send-status">{SEND_LABELS[s.status]}</span>
                {s.error && s.status !== 'sent' && <span className="basis-full text-[11px] text-gray-500 [overflow-wrap:anywhere]">{s.attempts > 0 ? `Attempt ${s.attempts}: ` : ''}{s.error}</span>}
                {s.status !== 'sent' && <button type="button" className={BTN} disabled={!!busy} data-testid="resend" onClick={() => void run(`resend-${s.sendId}`, () => callsApi.publicationResend(callId, s.sendId), (b) => `Sent again: ${SEND_LABELS[(b as unknown as { status: SendStatus }).status] ?? 'tried'}.`)}>Send again</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
