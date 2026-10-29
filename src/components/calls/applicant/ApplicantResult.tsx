'use client';
// Prompt 924 (Etapa 4, I2–I3) — the result of an application, as its applicant reads it: above their submitted application, once the entity has published. Nothing is shown (not even a hint) before that.
// What is here is the text that was built when the results went out: the label, the message, and the validated grade if the call shares it. A "Not selected" can be contested while the call lets them (a written
// reason, at most one PDF; ONCE), and afterwards the applicant reads what became of it. The confirmation is written in the page, never a browser dialog.
import { useCallback, useEffect, useRef, useState } from 'react';
import { RichText } from '@/components/RichText';
import { applicantApi, type ResultBody } from '@/lib/calls/applicant/client';
import { MAX_CONTEST_FILE_MB, MAX_REASON } from '@/lib/calls/contestations';
import { formatInZone } from '@/lib/calls/tz';
import { browserClient } from '@/lib/supabase';

const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50';
const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'document';

export function ApplicantResult({ applicationId, orgId, timezone }: { applicationId: string; orgId?: string | null; timezone?: string }) {
  const [data, setData] = useState<ResultBody | null>(null);
  const load = useCallback(async () => { const r = await applicantApi.result(applicationId); if (r.ok) setData(r.body); }, [applicationId]);
  useEffect(() => { void load(); }, [load]);
  if (!data?.result) return null;
  const { result, contest } = data;
  const tz = timezone ?? 'UTC';
  const when = new Date(result.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz });
  const tone = result.kind === 'advance' ? 'border-emerald-200 bg-emerald-50' : result.kind === 'waitlist' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50';
  return (
    <section className={`mb-5 min-w-0 rounded-xl border p-4 ${tone}`} data-testid="applicant-result" data-kind={result.kind} aria-label="Your result">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Your result · {when}</p>
      <h2 className="mt-1 min-w-0 text-lg font-semibold text-gray-900 [overflow-wrap:anywhere]" data-testid="result-label">{result.label}</h2>
      <RichText value={result.html} className="mt-2 text-sm text-gray-800" testId="result-message" />
      {contest && <ContestBox applicationId={applicationId} orgId={orgId ?? null} contest={contest} tz={tz} onDone={() => void load()} />}
    </section>
  );
}

function ContestBox({ applicationId, orgId, contest, tz, onDone }: { applicationId: string; orgId: string | null; contest: NonNullable<ResultBody['contest']>; tz: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  if (contest.state === 'done' && contest.contestation) {
    const c = contest.contestation;
    return (
      <div className="mt-4 min-w-0 border-t border-gray-200 pt-3" data-testid="contestation-status" data-status={c.status}>
        <p className="text-sm font-semibold text-gray-900">{c.status === 'open' ? 'Contestation under review' : c.status === 'upheld' ? 'Your contestation was accepted' : 'Your contestation was answered'}</p>
        <p className="mt-1 text-xs text-gray-500">Your reason</p>
        <p className="min-w-0 whitespace-pre-line text-sm text-gray-800 [overflow-wrap:anywhere]">{c.reason}</p>
        {c.fileName && <p className="mt-1 text-xs text-gray-500">Attached: {c.fileName}</p>}
        {c.response && <><p className="mt-2 text-xs text-gray-500">Response</p><p className="min-w-0 whitespace-pre-line text-sm text-gray-800 [overflow-wrap:anywhere]" data-testid="contestation-response">{c.response}</p></>}
      </div>
    );
  }
  if (contest.state === 'expired') return <p className="mt-3 text-xs text-gray-500" data-testid="contest-expired">The period to contest this decision ended on {formatInZone(contest.deadline, tz)}.</p>;
  if (contest.state !== 'available') return null;

  async function send() {
    setError('');
    if (!reason.trim()) { setError('Write the reason for your contestation.'); return; }
    if (file && !/\.pdf$/i.test(file.name)) { setError('Only a PDF file can be attached.'); return; }
    if (file && file.size > MAX_CONTEST_FILE_MB * 1024 * 1024) { setError(`The file is too large (maximum ${MAX_CONTEST_FILE_MB} MB).`); return; }
    setBusy('Sending…');
    try {
      let upload: { storagePath: string; fileName: string } | undefined;
      if (file) {
        if (!orgId) { setError('We could not attach the file. Please try again.'); return; }
        // (randomUUID only exists on a secure page; the name only has to be unique inside the startup's own folder)
        const unique = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        const path = `${orgId}/calls/${applicationId}/contest-${unique}-${safeName(file.name)}`;
        const { error: upErr } = await browserClient().storage.from('data-room').upload(path, file);
        if (upErr) { setError('We could not upload the file. Please try again.'); return; }
        upload = { storagePath: path, fileName: file.name };
      }
      const r = await applicantApi.contest(applicationId, { reason, ...(upload ?? {}) });
      if (!r.ok) { setError(r.body.error ?? 'We could not send your contestation. Please try again.'); return; }
      setOpen(false); onDone();
    } catch { setError('We could not send your contestation. Check your connection and try again.'); }
    finally { setBusy(''); }
  }

  return (
    <div className="mt-4 min-w-0 border-t border-gray-200 pt-3" data-testid="contest-box">
      <p className="text-xs text-gray-600">You can contest this decision until {formatInZone(contest.deadline, tz)}. Each application can contest once.</p>
      {!open ? (
        <button type="button" className="mt-2 min-h-[44px] rounded-lg border border-[#0E7490] px-4 py-2 text-sm font-semibold text-[#0E7490] hover:bg-[#E8F4F8]" data-testid="contest-open" onClick={() => setOpen(true)}>Contest this decision</button>
      ) : (
        <div className="mt-2 space-y-2" data-testid="contest-form">
          <label htmlFor="contest-reason" className="block text-xs font-medium text-gray-700">Why do you contest it? (required)</label>
          <textarea id="contest-reason" rows={5} autoComplete="off" className={INPUT} maxLength={MAX_REASON} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="contest-reason" />
          <div>
            <label htmlFor="contest-file" className="block text-xs font-medium text-gray-700">A document (optional, one PDF, up to {MAX_CONTEST_FILE_MB} MB)</label>
            <input id="contest-file" ref={input} type="file" accept="application/pdf,.pdf" className="mt-1 block w-full min-w-0 text-sm" data-testid="contest-file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <p className="text-sm font-medium text-gray-900" data-testid="contest-confirm">Send your contestation? You can contest only once and it cannot be edited afterwards.</p>
          {error && <p role="alert" className="text-xs text-[#B00000]" data-testid="contest-error">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40" disabled={!!busy} data-testid="contest-send" onClick={() => void send()}>{busy || 'Send contestation'}</button>
            <button type="button" className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" disabled={!!busy} data-testid="contest-cancel" onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
