'use client';
// Log an interaction — fast flow with pre-flight gate + live message linter
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { lintMessage, preflight, preflightSummary } from '@/lib/rules';
import { buildComposerContext, pickIntent, INTENT_LABEL, type ComposerIntent } from '@/lib/composer';
import type { Channel, Classification, OverrideRule, PassReasonCategory } from '@/lib/types';

const CHANNELS: { v: Channel; l: string }[] = [
  { v: 'linkedin_dm', l: 'LinkedIn DM' }, { v: 'linkedin_note', l: 'LinkedIn note' },
  { v: 'email', l: 'Email' }, { v: 'web_form', l: 'Web form' }, { v: 'call', l: 'Call' },
  { v: 'meeting', l: 'Meeting' }, { v: 'event', l: 'Event' }, { v: 'intro', l: 'Intro' },
];
const CLASSIFICATIONS: Classification[] = ['awaiting', 'interested', 'meeting_request', 'question', 'pass', 'out_of_office', 'bounce', 'unclear'];
const PASS_CATS: PassReasonCategory[] = ['valuation', 'check_size', 'geography', 'stage_too_early', 'thesis_mismatch', 'team', 'traction', 'other'];

function LogForm() {
  const { db, logInteraction } = useStore();
  const router = useRouter();
  const sp = useSearchParams();

  const [entityId, setEntityId] = useState(sp.get('entity') ?? '');
  const [personId, setPersonId] = useState(sp.get('person') ?? '');
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [channel, setChannel] = useState<Channel>('linkedin_dm');
  const [content, setContent] = useState('');
  const [classification, setClassification] = useState<Classification>('awaiting');
  const [passCat, setPassCat] = useState<PassReasonCategory>('other');
  const [passReason, setPassReason] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [nextDue, setNextDue] = useState('');
  const [docId, setDocId] = useState('');
  const [justification, setJustification] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [toast, setToast] = useState('');
  const [intent, setIntent] = useState<ComposerIntent>('first_touch');
  const [composing, setComposing] = useState(false);
  const [composerNote, setComposerNote] = useState('');
  const [composerMeta, setComposerMeta] = useState<{ rationale: string; confidence: number } | null>(null);

  const entity = db.entities.find((e) => e.id === entityId);
  const people = db.people.filter((p) => p.entity_id === entityId).sort((a, b) => a.seniority_rank - b.seniority_rank);
  const person = db.people.find((p) => p.id === personId);

  const checks = useMemo(() =>
    person && direction === 'out' ? preflight(db, person, channel) : [],
    [db, person, channel, direction]);
  const summary = preflightSummary(checks);
  const lint = useMemo(() =>
    person && direction === 'out' && content ? lintMessage(content, person, entity, channel) : [],
    [content, person, entity, channel, direction]);
  const lintErrors = lint.filter((f) => f.severity === 'error');
  const passMissing = direction === 'in' && classification === 'pass' && passReason.trim().length === 0;
  const formReady = entityId && content.trim().length > 0 && (direction === 'in' ? !!person || true : !!person) && !passMissing;

  useEffect(() => {
    if (entityId) setIntent(pickIntent(db, entityId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  async function draftWithAi() {
    if (!person || !entity) return;
    setComposing(true); setComposerNote(''); setComposerMeta(null);
    try {
      const context = buildComposerContext(db, entityId, personId, channel);
      const res = await fetch('/api/compose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context, channel, intent }),
      });
      const data = await res.json();
      if (data.configured === false) { setComposerNote(data.message); return; }
      if (data.error) { setComposerNote(`AI draft failed: ${data.error}`); return; }
      const subjectLine = channel === 'email' && data.draft.subject ? `Subject: ${data.draft.subject}\n\n` : '';
      setContent(subjectLine + data.draft.body);
      setComposerMeta({ rationale: data.draft.rationale, confidence: data.draft.confidence });
    } catch (e) {
      setComposerNote(`AI draft failed: ${(e as Error).message}`);
    } finally {
      setComposing(false);
    }
  }

  function save(withOverrides: boolean) {
    if (!formReady) return;
    const overrides = withOverrides
      ? summary.failed.filter((f) => f.overridable).map((f) => ({ rule: f.key as OverrideRule, justification }))
      : [];
    logInteraction({
      entity_id: entityId, person_id: personId || undefined, direction, channel, content,
      sent_from: direction === 'out' && channel === 'email' ? db.org.sender_email : undefined,
      document_id: docId || undefined,
      classification: direction === 'in' ? classification : direction === 'out' ? 'awaiting' : undefined,
      pass_reason_category: classification === 'pass' ? passCat : undefined,
      pass_reason: classification === 'pass' ? passReason : undefined,
      next_action: nextAction || undefined, next_action_due: nextDue || undefined,
      overrides,
    });
    if (direction === 'out') {
      setToast(`Saved. Contact lock set for 14 days · follow-up task created.${overrides.length ? ' Override logged.' : ''}`);
    } else {
      setToast('Reply saved.');
    }
    setTimeout(() => router.push(entityId ? `/entities/${entityId}` : '/'), 900);
  }

  const blockedHard = direction === 'out' && (summary.blocked || lintErrors.length > 0);
  const needsOverride = direction === 'out' && !summary.green && !summary.blocked;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="space-y-4 md:col-span-2">
        <h1 className="text-lg font-bold">Log an interaction</h1>

        <Card title="1 · Who">
          <div className="grid gap-2 sm:grid-cols-2">
            <select value={entityId} onChange={(e) => { setEntityId(e.target.value); setPersonId(''); }}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">Select entity…</option>
              {db.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <select value={personId} onChange={(e) => setPersonId(e.target.value)} disabled={!entityId}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">Select person…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id} disabled={p.do_not_contact}>
                  {p.seniority_rank} · {p.full_name}{p.do_not_contact ? ' — DO NOT CONTACT' : ''}
                </option>
              ))}
            </select>
          </div>
        </Card>

        <Card title="2 · What">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-gray-300">
              {(['out', 'in'] as const).map((d) => (
                <button key={d} onClick={() => setDirection(d)}
                  className={`px-3 py-1.5 text-sm ${direction === d ? 'bg-[#0E7490] text-white' : 'bg-white text-gray-600'}`}>
                  {d === 'out' ? '→ Outbound' : '← Inbound'}
                </button>
              ))}
            </div>
            <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              {CHANNELS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
            {direction === 'out' && channel === 'email' && (
              <span className="text-xs text-gray-400">from {db.org.sender_email} · BCC {db.org.bcc_email}</span>
            )}
          </div>

          {direction === 'out' && person && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-cyan-100 bg-[#E8F4F8]/50 px-3 py-2">
              <select value={intent} onChange={(e) => setIntent(e.target.value as ComposerIntent)}
                className="rounded border border-gray-300 px-2 py-1 text-xs">
                {(Object.keys(INTENT_LABEL) as ComposerIntent[]).map((i) => <option key={i} value={i}>{INTENT_LABEL[i]}</option>)}
              </select>
              <button disabled={composing} onClick={draftWithAi}
                className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                {composing ? 'Drafting…' : '✨ Draft with AI'}
              </button>
              <span className="text-[11px] text-gray-400">Draft only — you review, edit, and confirm before saving. Never auto-sent.</span>
            </div>
          )}
          {composerNote && <div className="mt-2 rounded bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600">{composerNote}</div>}
          {composerMeta && (
            <div className="mt-2 rounded bg-[#E8F4F8]/60 border border-cyan-100 px-3 py-2 text-xs text-cyan-900">
              <span className="font-semibold">AI rationale:</span> {composerMeta.rationale} · confidence {Math.round(composerMeta.confidence * 100)}%
            </div>
          )}

          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={7}
            placeholder={direction === 'out' ? 'Paste the message verbatim, or draft with AI above…' : 'Paste the reply verbatim…'}
            className="mt-3 w-full rounded border border-gray-300 p-2 text-sm font-mono" />
          {direction === 'out' && lint.length > 0 && (
            <ul className="mt-2 space-y-1">
              {lint.map((f, i) => (
                <li key={i} className={`text-xs ${f.severity === 'error' ? 'text-[#B00000] font-medium' : f.severity === 'warning' ? 'text-amber-700' : 'text-gray-500'}`}>
                  {f.severity === 'error' ? '✗' : f.severity === 'warning' ? '⚠' : 'ℹ'} {f.message}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <label className="text-xs text-gray-500">Material shared (view-only enforced)</label>
            <select value={docId} onChange={(e) => setDocId(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">None</option>
              {db.documents.map((d) => (
                <option key={d.id} value={d.id} disabled={!d.is_view_only}>
                  {d.name} {d.version ? `(${d.version})` : ''}{!d.is_view_only ? ' — not view-only, blocked' : ''}
                </option>
              ))}
            </select>
          </div>
        </Card>

        {direction === 'in' && (
          <Card title="3 · Classification">
            <select value={classification} onChange={(e) => setClassification(e.target.value as Classification)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
            </select>
            {classification === 'pass' && (
              <div className="mt-2 space-y-2 rounded border border-red-100 bg-red-50 p-2">
                <select value={passCat} onChange={(e) => setPassCat(e.target.value as PassReasonCategory)}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                  {PASS_CATS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
                <textarea value={passReason} onChange={(e) => setPassReason(e.target.value)} rows={2}
                  placeholder="Pass reason — REQUIRED. Verbatim if possible. Ten of these rewrite the pitch."
                  className="w-full rounded border border-gray-300 p-2 text-sm" />
              </div>
            )}
          </Card>
        )}

        <Card title={direction === 'in' ? '4 · Next action' : '3 · Next action'}>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Next action…"
              className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
            <input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
        </Card>

        <div>
          {toast && <div className="mb-2 rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">{toast}</div>}
          {direction === 'in' || summary.green ? (
            <button disabled={!formReady || (direction === 'out' && lintErrors.length > 0)} onClick={() => save(false)}
              className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              Save interaction
            </button>
          ) : blockedHard ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-[#B00000]">
              Blocked: {summary.blocked ? 'a non-overridable pre-flight check failed.' : 'fix the linter errors above.'}
            </div>
          ) : needsOverride && !showOverride ? (
            <button disabled={!formReady || lintErrors.length > 0} onClick={() => setShowOverride(true)}
              className="rounded-lg border border-amber-500 px-4 py-2 text-sm font-medium text-amber-700 disabled:opacity-40">
              Override & save… ({summary.failed.length} check{summary.failed.length > 1 ? 's' : ''} failed)
            </button>
          ) : (
            <div className="space-y-2">
              <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2}
                placeholder="Justification (required — written to the overrides audit log)"
                className="w-full rounded border border-amber-300 p-2 text-sm" />
              <div className="flex gap-2">
                <button disabled={justification.trim().length < 5 || lintErrors.length > 0} onClick={() => save(true)}
                  className="rounded-lg border border-amber-500 px-4 py-2 text-sm font-medium text-amber-700 disabled:opacity-40">
                  Confirm override & save
                </button>
                <button onClick={() => setShowOverride(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {person && direction === 'out' && (
          <>
            <Card title="Pre-flight">
              <ul className="space-y-1.5">
                {checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2 text-sm">
                    <span className={c.ok ? 'text-green-600' : 'text-[#B00000]'}>{c.ok ? '✓' : '✗'}</span>
                    <span className="flex-1">
                      <span className={c.ok ? 'text-gray-600' : 'font-medium'}>{c.label}</span>
                      {!c.ok && c.reason && <span className="block text-xs text-gray-500">{c.reason}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Context — never leave this screen" tint="blue">
              <dl className="space-y-2 text-sm">
                {person.hook && <div><dt className="text-xs text-gray-500">Hook</dt><dd>{person.hook}</dd></div>}
                {person.kill_words.length > 0 && (
                  <div><dt className="text-xs text-gray-500">Kill words</dt>
                    <dd className="flex flex-wrap gap-1">{person.kill_words.map((k) => <span key={k} className="rounded bg-red-100 px-1.5 text-xs text-red-800">{k}</span>)}</dd></div>
                )}
                {person.watch_outs && <div><dt className="text-xs text-gray-500">Watch-outs</dt><dd className="text-amber-800">{person.watch_outs}</dd></div>}
                {entity?.the_ask && <div><dt className="text-xs text-gray-500">The ask</dt><dd className="font-medium">{entity.the_ask}</dd></div>}
              </dl>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

export default function LogPage() {
  return <Suspense fallback={null}><LogForm /></Suspense>;
}
