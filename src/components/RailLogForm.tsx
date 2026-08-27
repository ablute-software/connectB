'use client';
// Prompt 397 §B.3 — "Log" mode of the entity page's conversation panel:
// record an interaction without leaving the page. Validation is NOT
// reimplemented — src/app/log/page.tsx was read in full before writing this,
// and the save() below calls the exact same store.logInteraction with the
// exact same preflight/lintMessage gates for outbound, so a message this
// form refuses is refused for the same reason /log would refuse it.
// Deliberately narrower than /log's own surface, though: no AI compose, no
// Gmail send, no web-form assist, no ask-amount field, and no post-save
// "suggested next action" flow — those stay full-page-only features, and
// /log itself keeps existing (shell nav + `/log?entity=` deep-links) for
// anything beyond a quick log. This is a documented scope decision, not a
// rule fork: every field that IS collected here is validated identically.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Tooltip, PREFLIGHT_EXPLAIN } from '@/components/ui';
import { lintMessage, preflight, preflightSummary } from '@/lib/rules';
import { nextContactPerson, PASS_REASON_CATEGORIES } from '@/lib/relationship';
import type { Channel, Classification, Entity, OverrideRule, PassReasonCategory } from '@/lib/types';

// Mirrors src/app/log/page.tsx's own CHANNELS/CLASSIFICATIONS — display
// labels only, not business logic, so a small duplicate is the same
// tradeoff already made by every other channel-label list in this codebase
// (EditInteractionDetails.tsx, InteractionLogTimeline.tsx, …).
const CHANNELS: { v: Channel; l: string }[] = [
  { v: 'linkedin_dm', l: 'LinkedIn DM' }, { v: 'linkedin_note', l: 'LinkedIn note' },
  { v: 'email', l: 'Email' }, { v: 'web_form', l: 'Web form' }, { v: 'call', l: 'Call' },
  { v: 'meeting', l: 'Meeting' }, { v: 'event', l: 'Event' }, { v: 'intro', l: 'Intro' },
];
const CLASSIFICATIONS: Classification[] = ['awaiting', 'interested', 'meeting_request', 'question', 'pass', 'out_of_office', 'bounce', 'unclear'];

export function RailLogForm({
  entity, defaultPersonId, prefillNonce, onSaved,
}: {
  entity: Entity;
  // Prompt 397 §A.4/§B.3.3 — the Sherlock Insight banner's "Log the first
  // interaction"/"Reply now" buttons prefill the target person here.
  // prefillNonce bumps on every click, even to the same person, since a
  // click is a fresh request to prefill, not just a value that happens to
  // match what's already selected.
  defaultPersonId?: string;
  prefillNonce?: number;
  onSaved: () => void;
}) {
  const { db, logInteraction } = useStore();
  const people = db.people.filter((p) => p.entity_id === entity.id).sort((a, b) => a.seniority_rank - b.seniority_rank);

  const [personId, setPersonId] = useState('');
  const [noSpecificPerson, setNoSpecificPerson] = useState(false);
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [channel, setChannel] = useState<Channel>('linkedin_dm');
  const [whatDate, setWhatDate] = useState('');
  const [content, setContent] = useState('');
  const [classification, setClassification] = useState<Classification | ''>('');
  const [passCat, setPassCat] = useState<PassReasonCategory>('other');
  const [passReason, setPassReason] = useState('');
  const [reopenAck, setReopenAck] = useState(false);
  const [justification, setJustification] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (defaultPersonId) {
      setPersonId(defaultPersonId);
      setNoSpecificPerson(false);
      setDirection('out');
    } else if (!personId) {
      const fallback = nextContactPerson(db, entity.id);
      if (fallback) setPersonId(fallback.id);
    }
    // Deliberately narrow: only re-applies on a fresh prefill request
    // (nonce bump) or first mount — must NOT stomp a founder's own manual
    // person choice on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillNonce]);

  const person = people.find((p) => p.id === personId);

  const checks = useMemo(() =>
    person && direction === 'out' ? preflight(db, person, channel) : [],
    [db, person, channel, direction]);
  const summary = preflightSummary(checks);
  const lint = useMemo(() =>
    person && direction === 'out' && content ? lintMessage(content, person, entity, channel) : [],
    [content, person, entity, channel, direction]);
  const lintErrors = lint.filter((f) => f.severity === 'error');

  const passMissing = direction === 'in' && classification === 'pass' && passReason.trim().length === 0;
  const classificationMissing = direction === 'in' && classification === '';
  const reopenTrigger = entity.status === 'dormant' ? entity.reopen_trigger : undefined;
  const reopenBlocked = direction === 'out' && !!reopenTrigger && !reopenAck;
  const formReady = content.trim().length > 0 && (direction === 'in' || !!person || noSpecificPerson) && !passMissing && !classificationMissing && !reopenBlocked;
  const disabledReason = content.trim().length === 0 ? 'Write the message content.'
    : direction === 'out' && !person && !noSpecificPerson ? 'Select a person, or choose "No specific person" if this was sent to a general channel.'
    : classificationMissing ? 'Choose what they said — it decides the stage.'
    : passMissing ? 'A pass reason is required.'
    : reopenBlocked ? 'Confirm the reopening checkbox above.'
    : null;

  const blockedHard = direction === 'out' && (summary.blocked || lintErrors.length > 0);
  const needsOverride = direction === 'out' && !summary.green && !summary.blocked;
  const needsManualSendConfirmation = direction === 'out' && (channel === 'email' || channel === 'linkedin_dm' || channel === 'linkedin_note');
  const primarySaveLabel = needsManualSendConfirmation ? 'I confirm this was sent' : 'Save interaction';

  function save(withOverrides: boolean) {
    if (!formReady) return;
    const overrides = withOverrides
      ? summary.failed.filter((f) => f.overridable).map((f) => ({ rule: f.key as OverrideRule, justification }))
      : [];
    logInteraction({
      entity_id: entity.id, person_id: personId || undefined, direction, channel, content,
      occurred_at: whatDate ? new Date(whatDate).toISOString() : undefined,
      sent_from: direction === 'out' && channel === 'email' ? db.org.sender_email : undefined,
      classification: direction === 'in' ? (classification as Classification) : direction === 'out' ? 'awaiting' : undefined,
      pass_reason_category: classification === 'pass' ? passCat : undefined,
      pass_reason: classification === 'pass' ? passReason : undefined,
      overrides,
    });
    setToast(direction === 'out' ? `Saved. Contact lock set for 14 days.${overrides.length ? ' Override logged.' : ''}` : 'Reply saved.');
    setContent(''); setClassification(''); setPassReason(''); setJustification(''); setShowOverride(false); setReopenAck(false);
    window.setTimeout(() => { setToast(''); onSaved(); }, 700);
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Person</label>
        <select value={noSpecificPerson ? '__none__' : personId}
          onChange={(e) => {
            if (e.target.value === '__none__') { setPersonId(''); setNoSpecificPerson(true); }
            else { setPersonId(e.target.value); setNoSpecificPerson(false); }
          }}
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">Select person…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id} disabled={p.do_not_contact}>
              {p.seniority_rank} · {p.full_name}{p.do_not_contact ? ' — DO NOT CONTACT' : ''}
            </option>
          ))}
          <option value="__none__">No specific person — general/website channel</option>
        </select>
      </div>

      <div className="flex gap-2">
        <div className="flex overflow-hidden rounded-lg border border-gray-300">
          {(['out', 'in'] as const).map((d) => (
            <button key={d} onClick={() => setDirection(d)}
              className={`px-2.5 py-1.5 text-xs font-medium ${direction === d ? 'bg-[#0E7490] text-white' : 'bg-white text-gray-600'}`}>
              {d === 'out' ? '→ Out' : '← In'}
            </button>
          ))}
        </div>
        <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}
          className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs">
          {CHANNELS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
        </select>
      </div>
      <input type="date" value={whatDate} onChange={(e) => setWhatDate(e.target.value)}
        title="When this happened — defaults to now if left blank"
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs" />

      <div>
        <label className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">What happened</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5}
          placeholder={direction === 'out' ? 'Paste the message verbatim…' : 'Paste the reply verbatim…'}
          className="mt-1 w-full rounded border border-gray-300 p-2 text-sm" />
      </div>

      {direction === 'out' && lint.length > 0 && (
        <ul className="space-y-1">
          {lint.map((f, i) => (
            <li key={i} className={`text-[11px] ${f.severity === 'error' ? 'font-medium text-[#B00000]' : f.severity === 'warning' ? 'text-amber-700' : 'text-gray-500'}`}>
              {f.severity === 'error' ? '✗' : f.severity === 'warning' ? '⚠' : 'ℹ'} {f.message}
            </li>
          ))}
        </ul>
      )}

      {direction === 'out' && person && checks.length > 0 && (
        <div className="rounded-lg bg-gray-50 px-2.5 py-2">
          <ul className="space-y-1">
            {checks.map((c) => (
              <li key={c.key} className="flex items-start gap-1.5 text-[11px]">
                <span className={c.ok ? 'text-green-600' : 'text-[#B00000]'}>{c.ok ? '✓' : '✗'}</span>
                <Tooltip text={PREFLIGHT_EXPLAIN[c.key] ?? c.label} side="right">
                  <span className={c.ok ? 'text-gray-500' : 'font-medium text-gray-700'}>{c.label}</span>
                </Tooltip>
              </li>
            ))}
          </ul>
        </div>
      )}

      {direction === 'in' && (
        <div>
          <label className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Classification</label>
          <select value={classification} onChange={(e) => setClassification(e.target.value as Classification)}
            className={`mt-1 w-full rounded border px-2 py-1.5 text-sm ${classification === '' ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`}>
            <option value="" disabled>Choose what they said…</option>
            {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
          {classification === '' && (
            <p className="mt-1 text-[11px] text-amber-700">Required — decides the stage.</p>
          )}
          {classification === 'pass' && (
            <div className="mt-1.5 space-y-1.5 rounded border border-red-100 bg-red-50 p-2">
              <select value={passCat} onChange={(e) => setPassCat(e.target.value as PassReasonCategory)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-xs">
                {PASS_REASON_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
              <textarea value={passReason} onChange={(e) => setPassReason(e.target.value)} rows={2}
                placeholder="Pass reason — required, verbatim if possible."
                className="w-full rounded border border-gray-300 p-2 text-xs" />
            </div>
          )}
        </div>
      )}

      {reopenTrigger && direction === 'out' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Your note when freezing</p>
          <p className="text-xs text-amber-900">&ldquo;{reopenTrigger}&rdquo;</p>
          <label className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-800">
            <input type="checkbox" checked={reopenAck} onChange={(e) => setReopenAck(e.target.checked)} className="mt-0.5" />
            <span>The draft cites the earlier pass and what changed.</span>
          </label>
        </div>
      )}

      {toast && <div className="rounded border border-green-200 bg-green-50 px-2.5 py-1.5 text-xs text-green-800">{toast}</div>}

      {blockedHard ? (
        <div className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-[#B00000]">
          Blocked: {summary.blocked ? 'a non-overridable pre-flight check failed.' : 'fix the linter errors above.'}
        </div>
      ) : needsOverride && !showOverride ? (
        <Tooltip text="Proceed despite the failed checks — requires a written justification, logged to the audit trail.">
          <button disabled={!formReady || lintErrors.length > 0} onClick={() => setShowOverride(true)}
            className="w-full rounded-lg border border-amber-500 px-3 py-1.5 text-xs font-medium text-amber-700 disabled:opacity-40">
            Override & save… ({summary.failed.length} check{summary.failed.length > 1 ? 's' : ''} failed)
          </button>
        </Tooltip>
      ) : needsOverride && showOverride ? (
        <div className="space-y-1.5">
          <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2}
            placeholder="Justification (required — written to the overrides audit log)"
            className="w-full rounded border border-amber-300 p-2 text-xs" />
          <div className="flex gap-1.5">
            <button disabled={justification.trim().length < 5 || lintErrors.length > 0} onClick={() => save(true)}
              className="flex-1 rounded-lg border border-amber-500 px-3 py-1.5 text-xs font-medium text-amber-700 disabled:opacity-40">
              Confirm override & save
            </button>
            <button onClick={() => setShowOverride(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs">Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          <Tooltip text={needsManualSendConfirmation
            ? 'Confirms you sent this yourself outside the app, then logs it and applies its follow-on effects (contact lock, suggested next step).'
            : 'Logs this interaction and applies its follow-on effects (contact lock, suggested next step).'}>
            <button disabled={!formReady || (direction === 'out' && lintErrors.length > 0)} onClick={() => save(false)}
              className="w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
              {primarySaveLabel}
            </button>
          </Tooltip>
          {!formReady && disabledReason && <p className="mt-1 text-[11px] text-gray-400">{disabledReason}</p>}
        </div>
      )}
    </div>
  );
}
