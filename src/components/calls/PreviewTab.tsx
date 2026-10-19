'use client';
// Prompt 905 / 909 — Calls editor, tab "Preview & validate" (spec §8). Left: the form, either as a FREE preview (every page
// and question reachable, nothing enforced) or, with "Test the form", in test mode (exactly as an applicant must fill it,
// nothing saved or sent). Right: a summary of what is configured, what is still
// missing, and the life of the call — Validate form and settings, Edit configuration, Publish, extend the deadline, close early — and,
// once published, the call's link with a Copy button.
import { useRef, useState } from 'react';
import { formatInZone, utcToWall, wallToUtcIso } from '@/lib/calls/tz';
import { callLink } from '@/lib/calls/link';
import { CONTENT_LANGUAGES, type Call, type CallPhase, type FormField } from '@/lib/calls/types';
import type { CallSummary, ReadinessIssue, availableActions } from '@/lib/calls/lifecycle';
import { stepLabel, stepOfIssue, type StepKey } from '@/lib/calls/editor-nav';
import { FormPreview } from './FormPreview';
import { FormTest } from './FormTest';
import { StatusBadge } from './StatusBadge';
import type { CallStatus } from '@/lib/calls/types';


export type LifecycleAction = 'confirm' | 'edit' | 'publish' | 'extend' | 'reopen' | 'close' | 'archive';

// The URL builder lives in lib/calls/link.ts (the back-office Calls page uses the very same one); re-exported here
// so existing imports keep working.
export { callLink };

export function PreviewTab({ call, effectiveStatus, phases, fields, issues, summary, actions, canManage, busy, error, origin, onJump, onAction }: {
  call: Call; effectiveStatus: CallStatus; phases: CallPhase[]; fields: FormField[]; issues: ReadinessIssue[]; summary: CallSummary;
  actions: ReturnType<typeof availableActions>; canManage: boolean; busy: boolean; error: string; origin: string;
  /** Takes the person to the step — and to the field — that the problem is about. */
  onJump: (step: StepKey, target?: string) => void; onAction: (a: LifecycleAction, extra?: { closesAt?: string; confirmEarly?: boolean }) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [extendWall, setExtendWall] = useState('');
  // "Reopen and extend" (a closed call): the new deadline, and — when the call was closed early on purpose — the person's explicit confirmation.
  const [reopenWall, setReopenWall] = useState('');
  const [earlyOk, setEarlyOk] = useState(false);
  const link = call.linkToken ? callLink(origin, call.linkToken) : null;
  const lang = CONTENT_LANGUAGES.find((l) => l.code === call.contentLanguage)?.label ?? call.contentLanguage;
  const closesWall = utcToWall(call.closesAt, call.timezone);
  const extendIso = extendWall ? wallToUtcIso(extendWall, call.timezone) : null;
  const extendOk = !!extendIso && !!call.closesAt && Date.parse(extendIso) > Date.parse(call.closesAt);
  const reopenIso = reopenWall ? wallToUtcIso(reopenWall, call.timezone) : null;
  const reopenInFuture = !!reopenIso && Date.parse(reopenIso) > Date.now();
  const reopenOk = reopenInFuture && (!actions.reopenNeedsConfirm || earlyOk);

  const linkInput = useRef<HTMLInputElement>(null);
  const [copyHint, setCopyHint] = useState('');

  // Clipboard API first; if the browser refuses (no permission, not a secure context) select the link and try the
  // old command; if even that fails, leave it selected and say so — never a pop-up.
  async function copy() {
    if (!link) return;
    setCopyHint('');
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const el = linkInput.current;
      el?.focus(); el?.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      if (!ok) { setCopied(false); setCopyHint('The link is selected — press Ctrl+C (⌘C on a Mac) to copy it.'); return; }
    }
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  }

  const row = (k: string, v: React.ReactNode) => (<><dt className="text-gray-400">{k}</dt><dd className="text-gray-800">{v}</dd></>);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]" data-testid="preview-tab">
      <div className="space-y-3">
        {canManage && fields.length > 0 && (
          <div className="flex items-center justify-between gap-3" data-testid="test-switch">
            <p className="text-xs text-gray-500">{testing ? 'Filling it in exactly as an applicant must.' : 'Just looking. To go through it as an applicant must, test the form.'}</p>
            {!testing && (
              <button type="button" onClick={() => setTesting(true)} data-testid="test-form"
                className="shrink-0 rounded-lg border border-[#0E7490] px-3 py-1.5 text-sm font-medium text-[#0E7490] hover:bg-[#E8F4F8]">Test the form</button>
            )}
          </div>
        )}
        {testing && canManage
          ? <FormTest fields={fields} currency={call.currency} title={call.name} onExit={() => setTesting(false)} />
          : <FormPreview fields={fields} currency={call.currency} title={call.name} />}
      </div>

      <div className="space-y-4">
        <section className="rounded-lg border border-gray-200 bg-white p-4" aria-label="Summary">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Summary</h3>
            <StatusBadge status={effectiveStatus} />
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs" data-testid="summary">
            {row('Name', call.name || '—')}
            {row('Opens', formatInZone(call.opensAt, call.timezone))}
            {row('Closes', formatInZone(call.closesAt, call.timezone))}
            {row('Listing', call.visibility === 'listed' ? 'Listed in Open calls' : 'Closed — link only')}
            {row('Limit', `${call.limitUnit === 'legal_entity' ? 'Per legal entity' : 'Per project'}${call.allowMultiple ? ', several allowed' : ', one only'}`)}
            {row('Language', `${lang} · ${call.currency}`)}
            {row('Phases', summary.phases)}
            {row('Form', `${summary.questions} question${summary.questions === 1 ? '' : 's'} + ${summary.documents} document${summary.documents === 1 ? '' : 's'} on ${summary.pages} page${summary.pages === 1 ? '' : 's'}`)}
            {row('Details', `${summary.required} required · ${summary.mapped} linked to platform data · ${summary.conditional} conditional`)}
          </dl>
          <p className="mt-3 text-[11px] text-gray-400">Eligibility rules, team and evaluation are configured in the next stage.</p>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4" aria-label="What is missing" data-testid="missing">
          <h3 className="text-sm font-semibold text-gray-900">{issues.length === 0 ? 'Nothing is missing' : `What is missing (${issues.length})`}</h3>
          {issues.length > 0 && (
            <ul className="mt-2 space-y-1.5 text-xs">
              {issues.map((i, n) => (
                <li key={n} className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                  <span className="min-w-0 flex-1 text-gray-700">{i.message}</span>
                  <button type="button" onClick={() => onJump(stepOfIssue(i), i.target)} data-testid="missing-go" className="min-h-[44px] shrink-0 px-1 font-medium text-[#0E7490] hover:underline sm:min-h-0">Go to {stepLabel(stepOfIssue(i))}</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canManage && (
          <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4" aria-label="Status actions" data-testid="lifecycle">
            <h3 className="text-sm font-semibold text-gray-900">Validate and publish</h3>
            {call.status === 'draft' && (
              <>
                <button type="button" disabled={busy || !actions.canConfirm} onClick={() => onAction('confirm')} data-testid="confirm"
                  className="w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">Validate form and settings</button>
                <p className="text-[11px] text-gray-400">Validating locks the configuration. The call stays unpublished until you click Publish. Until the call opens you can always use “Edit configuration”, which withdraws the validation.</p>
              </>
            )}
            {call.status === 'validated' && (
              <p className="text-[11px] text-gray-500" data-testid="validated-note">Validated. The call is not published yet: there is no link and nobody can apply until you click Publish.</p>
            )}
            {actions.canPublish && (
              <button type="button" disabled={busy} onClick={() => onAction('publish')} data-testid="publish"
                className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-40">Publish and get the link</button>
            )}
            {actions.canEditConfiguration && (
              <button type="button" disabled={busy} onClick={() => onAction('edit')} data-testid="edit-config"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">Edit configuration</button>
            )}
            {(effectiveStatus === 'open' || effectiveStatus === 'scheduled') && (
              <p className="text-[11px] text-gray-500">{effectiveStatus === 'open' ? 'The call is open: questions and options are locked.' : 'The call opens by itself at its opening time.'}</p>
            )}
            {actions.canExtend && (
              <div className="rounded-lg bg-gray-50 p-3" data-testid="extend">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor="extend-to">Extend the deadline for everyone</label>
                <input id="extend-to" type="datetime-local" autoComplete="off" className="mt-1 block w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" value={extendWall} min={closesWall}
                  onChange={(e) => setExtendWall(e.target.value)} />
                <button type="button" disabled={busy || !extendOk} onClick={() => onAction('extend', { closesAt: extendIso! })}
                  className="mt-2 rounded-lg border border-[#0E7490] px-3 py-1.5 text-sm font-medium text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">Extend deadline</button>
                {extendWall && !extendOk && <p className="mt-1 text-[11px] text-[#B00000]">The new deadline must be later than the current one.</p>}
              </div>
            )}
            {actions.canReopen && (
              <div className="rounded-lg bg-gray-50 p-3" data-testid="reopen">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Reopen and extend</p>
                <p className="mt-1 text-[11px] text-gray-500">{effectiveStatus === 'archived' ? 'This call is archived (it had closed). Reopening takes it out of the archive. ' : ''}{actions.reopenNeedsConfirm ? 'This call was closed early, on purpose.' : 'This call closed at its deadline.'} Reopen it with a new deadline and applicants can submit again.</p>
                <label className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-gray-500" htmlFor="reopen-to">New deadline</label>
                <input id="reopen-to" type="datetime-local" autoComplete="off" className="mt-1 block w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" value={reopenWall} data-testid="reopen-date"
                  onChange={(e) => setReopenWall(e.target.value)} />
                {reopenWall && !reopenInFuture && <p className="mt-1 text-[11px] text-[#B00000]" data-testid="reopen-past">The new deadline must be in the future.</p>}
                {reopenInFuture && (
                  <p className="mt-2 text-xs text-gray-700" data-testid="reopen-sentence">Applicants who had not submitted will be able to submit until «{formatInZone(reopenIso!, call.timezone)}». Submitted applications are not affected.</p>
                )}
                {actions.reopenNeedsConfirm && (
                  <label className="mt-2 flex items-start gap-2 text-xs text-gray-700"><input type="checkbox" className="mt-0.5" checked={earlyOk} onChange={(e) => setEarlyOk(e.target.checked)} data-testid="reopen-early-ok" />
                    <span>I closed this call early on purpose and I want to reopen it.</span></label>
                )}
                <button type="button" disabled={busy || !reopenOk} data-testid="reopen-button"
                  onClick={() => { if (window.confirm(`Reopen the call until ${formatInZone(reopenIso!, call.timezone)}? Applicants who had not submitted will be able to submit. Submitted applications are not affected.`)) onAction('reopen', { closesAt: reopenIso!, confirmEarly: earlyOk }); }}
                  className="mt-2 rounded-lg border border-[#0E7490] px-3 py-1.5 text-sm font-medium text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">Reopen and extend</button>
              </div>
            )}
            {actions.canClose && (
              <button type="button" disabled={busy} onClick={() => { if (window.confirm('Close the call now? Nobody will be able to submit a new application. What has already come in is kept.')) onAction('close'); }}
                data-testid="close-early" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-[#B00000] hover:bg-gray-50 disabled:opacity-40">Close early</button>
            )}
            {error && <p role="alert" className="text-xs text-[#B00000]" data-testid="action-error">{error}</p>}
          </section>
        )}

        {link && (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4" aria-label="Link of the call" data-testid="call-link">
            <h3 className="text-sm font-semibold text-emerald-900">The link of this call</h3>
            <div className="mt-2 flex items-center gap-2">
              <input ref={linkInput} readOnly aria-label="Call link" autoComplete="off" value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs" data-testid="link-input" />
              <button type="button" onClick={copy} className="shrink-0 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800" data-testid="copy-link">{copied ? 'Copied ✓' : 'Copy link'}</button>
            </div>
            {copyHint && <p role="status" className="mt-1.5 text-[11px] font-medium text-emerald-900" data-testid="copy-hint">{copyHint}</p>}
            <p className="mt-2 text-[11px] text-emerald-900/70">
              Applicants open this link, register or sign in, and fill in and submit the form. Until the call opens, the page tells them when it does.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
