'use client';
// Log an interaction — fast flow with pre-flight gate + live message linter
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore } from '@/lib/store';
import { Card, PREFLIGHT_EXPLAIN, Tooltip } from '@/components/ui';
import { lintMessage, preflight, preflightSummary } from '@/lib/rules';
import { buildComposerContext, pickIntent, INTENT_LABEL, type ComposerIntent } from '@/lib/composer';
import { ACTION_TYPE_LABEL, ACTION_TYPES, recommendedActionType, relationshipSummary } from '@/lib/relationship';
import { evaluateProvenanceGate, type ComposerClaim } from '@/lib/company-canon-logic';
import type { ActionType, Channel, Classification, OverrideRule, PassReasonCategory } from '@/lib/types';

const CHANNELS: { v: Channel; l: string }[] = [
  { v: 'linkedin_dm', l: 'LinkedIn DM' }, { v: 'linkedin_note', l: 'LinkedIn note' },
  { v: 'email', l: 'Email' }, { v: 'web_form', l: 'Web form' }, { v: 'call', l: 'Call' },
  { v: 'meeting', l: 'Meeting' }, { v: 'event', l: 'Event' }, { v: 'intro', l: 'Intro' },
];
const CLASSIFICATIONS: Classification[] = ['awaiting', 'interested', 'meeting_request', 'question', 'pass', 'out_of_office', 'bounce', 'unclear'];
const PASS_CATS: PassReasonCategory[] = ['valuation', 'check_size', 'geography', 'stage_too_early', 'thesis_mismatch', 'team', 'traction', 'other'];

function LogForm() {
  const { db, logInteraction, addCompanyFact } = useStore();
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
  const [nextActionType, setNextActionType] = useState<ActionType>('other');
  const [actionTypeTouched, setActionTypeTouched] = useState(false);
  const [reopenAck, setReopenAck] = useState(false);
  const [docId, setDocId] = useState('');
  const [justification, setJustification] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [toast, setToast] = useState('');
  const [intent, setIntent] = useState<ComposerIntent>('first_touch');
  const [composing, setComposing] = useState(false);
  const [composerNote, setComposerNote] = useState('');
  const [composerMeta, setComposerMeta] = useState<{ rationale: string; confidence: number } | null>(null);
  const [aiGenerated, setAiGenerated] = useState(false);
  const [subject, setSubject] = useState('');
  const [gmail, setGmail] = useState<{ configured: boolean; connected: boolean; email?: string | null } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState('');
  const [draftedFor, setDraftedFor] = useState<{ key: string; label: string } | null>(null);
  // IRM_SPEC §11b — provenance gate. Only ever populated when the composer
  // response includes claims[] (itself only present once canon facts exist
  // to ground against) AND at least one claim isn't grounded — so this
  // stays empty/inert for every draft until then.
  const [pendingQuestions, setPendingQuestions] = useState<ComposerClaim[]>([]);
  const [pendingAnswer, setPendingAnswer] = useState('');

  useEffect(() => {
    fetch('/api/oauth/google/status').then((r) => r.json()).then(setGmail).catch(() => setGmail({ configured: false, connected: false }));
  }, []);

  const entity = db.entities.find((e) => e.id === entityId);
  const people = db.people.filter((p) => p.entity_id === entityId).sort((a, b) => a.seniority_rank - b.seniority_rank);
  const person = db.people.find((p) => p.id === personId);
  // Batch 2 item 2 — a first-ever touch means there's no LinkedIn
  // connection yet (a connection request + note is the only thing that can
  // reach them); any later touch means they're presumably already
  // connected (a DM is the fit). Reuses the same "how many times have we
  // touched this entity" signal composer.ts's pickIntent already relies on.
  const touchCount = useMemo(() => entityId ? relationshipSummary(db, entityId).touchCount : 0, [db, entityId]);

  const checks = useMemo(() =>
    person && direction === 'out' ? preflight(db, person, channel) : [],
    [db, person, channel, direction]);
  const summary = preflightSummary(checks);
  const lint = useMemo(() =>
    person && direction === 'out' && content ? lintMessage(content, person, entity, channel) : [],
    [content, person, entity, channel, direction]);
  const lintErrors = lint.filter((f) => f.severity === 'error');
  const passMissing = direction === 'in' && classification === 'pass' && passReason.trim().length === 0;
  const hookNotResearched = !!person && person.hook_status !== 'researched';
  const reopenTrigger = entity?.status === 'dormant' ? entity.reopen_trigger : undefined;
  const reopenBlocked = direction === 'out' && !!reopenTrigger && !reopenAck;
  const formReady = entityId && content.trim().length > 0 && (direction === 'in' ? !!person || true : !!person) && !passMissing && !reopenBlocked;

  useEffect(() => {
    if (entityId) setIntent(pickIntent(db, entityId));
    setAiGenerated(false); setComposerMeta(null); setComposerNote('');
    setNextActionType(entityId ? recommendedActionType(db, entityId, personId || undefined) : 'other');
    setActionTypeTouched(false); setReopenAck(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, personId]);

  // Stamps whoever the current message content was written for — whether
  // typed by hand or AI-drafted — so a later entity/person switch (without
  // clearing the textarea) can be caught as a stale draft below.
  useEffect(() => {
    if (content.trim().length === 0) { setDraftedFor(null); return; }
    setDraftedFor({
      key: `${entityId}|${personId}`,
      label: person ? `${person.full_name} (${entity?.name ?? ''})` : (entity?.name ?? ''),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const staleDraft = draftedFor && content.trim().length > 0 && draftedFor.key !== `${entityId}|${personId}`
    ? draftedFor : null;

  async function draftWithAi() {
    if (!person || !entity) return;
    setComposing(true); setComposerNote(''); setComposerMeta(null); setPendingQuestions([]);
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

      // §11b HARD gate: a draft with any claim that isn't confirmed-or-
      // flagged is never shown. Only reachable when the server actually
      // returned claims[] (canon-gated mode) — see /api/compose's
      // canonGated branch, itself inert until a fact is confirmed.
      if (data.draft.claims?.length) {
        const confirmedIds = new Set(db.companyFacts.filter((f) => f.status === 'confirmed').map((f) => f.id));
        const gate = evaluateProvenanceGate(data.draft, confirmedIds);
        if (!gate.grounded) {
          const unresolved = [
            ...gate.pendingQuestions,
            ...gate.ungroundedClaims.map((c) => ({
              ...c,
              needsConfirmation: c.needsConfirmation ?? {
                question: `The draft states "${c.text}" — is that accurate?`,
                options: ['Yes — add to the canon', 'No — leave it out'],
              },
            })),
          ];
          setPendingQuestions(unresolved);
          setComposerNote('This draft made a claim that needs your confirmation first — the draft itself is not shown yet.');
          return;
        }
      }

      setContent(data.draft.body);
      if (channel === 'email') setSubject(data.draft.subject ?? '');
      setComposerMeta({ rationale: data.draft.rationale, confidence: data.draft.confidence });
      setAiGenerated(true);
    } catch (e) {
      setComposerNote(`AI draft failed: ${(e as Error).message}`);
    } finally {
      setComposing(false);
    }
  }

  function answerPendingQuestion(answer: string) {
    if (!pendingQuestions[0]) return;
    const now = new Date().toISOString();
    addCompanyFact({ category: 'other', statement: answer, status: 'confirmed', source: 'user', confirmed_at: now });
    const rest = pendingQuestions.slice(1);
    setPendingQuestions(rest);
    setPendingAnswer('');
    if (rest.length === 0) { setComposerNote(''); draftWithAi(); } // all answered — regenerate
  }

  function save(withOverrides: boolean, sentFrom?: string) {
    if (!formReady) return;
    const overrides = withOverrides
      ? summary.failed.filter((f) => f.overridable).map((f) => ({ rule: f.key as OverrideRule, justification }))
      : [];
    const fullContent = channel === 'email' && subject ? `Subject: ${subject}\n\n${content}` : content;
    logInteraction({
      entity_id: entityId, person_id: personId || undefined, direction, channel, content: fullContent,
      sent_from: direction === 'out' && channel === 'email' ? (sentFrom ?? db.org.sender_email) : undefined,
      document_id: docId || undefined,
      classification: direction === 'in' ? classification : direction === 'out' ? 'awaiting' : undefined,
      pass_reason_category: classification === 'pass' ? passCat : undefined,
      pass_reason: classification === 'pass' ? passReason : undefined,
      next_action: nextAction || undefined, next_action_due: nextDue || undefined,
      next_action_type: nextAction ? nextActionType : undefined,
      overrides,
      ai_generated: aiGenerated || undefined,
    });
    if (direction === 'out') {
      setToast(`${sentFrom ? `Sent from ${sentFrom} and logged` : 'Saved'}. Contact lock set for 14 days · follow-up task created.${overrides.length ? ' Override logged.' : ''}`);
    } else {
      setToast('Reply saved.');
    }
    setTimeout(() => router.push(entityId ? `/entities/${entityId}` : '/'), 900);
  }

  async function sendViaGmail() {
    if (!person?.email_verified || !formReady || lintErrors.length > 0) return;
    setSending(true); setSendErr('');
    try {
      const res = await fetch('/api/compose/send', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: person.email_verified, subject, body: content }),
      });
      const data = await res.json();
      if (data.ok === false) { setSendErr(data.error); return; }
      save(false, data.sentFrom);
    } catch (e) {
      setSendErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const canSendViaGmail = direction === 'out' && channel === 'email' && gmail?.connected && !!person?.email_verified;
  const blockedHard = direction === 'out' && (summary.blocked || lintErrors.length > 0);
  const needsOverride = direction === 'out' && !summary.green && !summary.blocked;
  // Batch 2 item 2 — the primary action reads as a confirmation, not a
  // generic save, for every channel that has to be sent manually outside
  // the app (email without Gmail connected, or either LinkedIn channel —
  // LinkedIn never auto-sends). Everything else (inbound logging, calls,
  // meetings, etc.) keeps the plain "Save interaction" label.
  const needsManualSendConfirmation = direction === 'out'
    && ((channel === 'email' && !canSendViaGmail) || channel === 'linkedin_dm' || channel === 'linkedin_note');
  const primarySaveLabel = needsManualSendConfirmation ? 'Confirmo que enviei' : 'Save interaction';

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
              <Tooltip text="Generates a draft using this person's hook and the entity's context — never sent automatically.">
                <button disabled={composing} onClick={draftWithAi}
                  className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                  {composing ? 'Drafting…' : '✨ Draft with AI'}
                </button>
              </Tooltip>
              <span className="text-[11px] text-gray-400">Draft only — you review, edit, and confirm before saving. Never auto-sent.</span>
            </div>
          )}
          {composerNote && <div className="mt-2 rounded bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600">{composerNote}</div>}
          {pendingQuestions[0] && (
            <div className="mt-2 rounded-lg border border-purple-300 bg-purple-50 p-3">
              <p className="text-sm font-medium text-purple-900">{pendingQuestions[0].needsConfirmation!.question}</p>
              <p className="mt-0.5 text-xs text-purple-700">Your answer is added to the Company canon so future drafts already know it.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {pendingQuestions[0].needsConfirmation!.options.map((opt) => (
                  <button key={opt} onClick={() => answerPendingQuestion(opt)}
                    className="rounded-lg border border-purple-300 bg-white px-2.5 py-1 text-xs font-medium text-purple-800 hover:bg-purple-100">
                    {opt}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input value={pendingAnswer} onChange={(e) => setPendingAnswer(e.target.value)} placeholder="Or type the real answer…"
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs" />
                <button disabled={!pendingAnswer.trim()} onClick={() => answerPendingQuestion(pendingAnswer.trim())}
                  className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Confirm</button>
              </div>
              {pendingQuestions.length > 1 && <p className="mt-1.5 text-[11px] text-purple-600">{pendingQuestions.length - 1} more after this one.</p>}
            </div>
          )}
          {composerMeta && (
            <div className="mt-2 rounded bg-[#E8F4F8]/60 border border-cyan-100 px-3 py-2 text-xs text-cyan-900">
              <span className="font-semibold">AI rationale:</span> {composerMeta.rationale} · confidence {Math.round(composerMeta.confidence * 100)}%
            </div>
          )}

          {staleDraft && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2">
              <span className="flex-1 text-sm font-medium text-amber-900">
                Este rascunho foi composto para {staleDraft.label} — atualiza ou regenera antes de usar.
              </span>
              {direction === 'out' && person && (
                <Tooltip text="Redrafts the message for the currently selected person and entity.">
                  <button disabled={composing} onClick={draftWithAi}
                    className="rounded border border-amber-500 bg-white px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40">
                    {composing ? 'Regenerando…' : '↻ Regenerar'}
                  </button>
                </Tooltip>
              )}
              <Tooltip text="Empties the message field so you can start fresh.">
                <button onClick={() => setContent('')}
                  className="rounded border border-amber-500 bg-white px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">
                  Limpar
                </button>
              </Tooltip>
            </div>
          )}
          {direction === 'out' && channel === 'email' && (
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject"
              className="mt-3 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          )}
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={7}
            placeholder={direction === 'out' ? 'Paste the message verbatim, or draft with AI above…' : 'Paste the reply verbatim…'}
            className="mt-3 w-full rounded border border-gray-300 p-2 text-sm font-mono" />
          {direction === 'out' && (channel === 'linkedin_dm' || channel === 'linkedin_note') && content && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
              <span className="text-gray-500">
                LinkedIn não permite envio automático (ToS) — copia e cola a mensagem manualmente, depois confirma abaixo para a registar.
                {channel === 'linkedin_dm' && touchCount === 0 && ' Ainda sem contacto registado — talvez um pedido de ligação com nota (até 300 caracteres) em vez de DM, que exige ligação já feita.'}
                {channel === 'linkedin_note' && touchCount > 0 && ' Já há contacto registado — provavelmente já estão ligados; um DM pode ser mais adequado que um pedido de ligação.'}
              </span>
              <Tooltip text="Copies the message text so you can paste it into LinkedIn.">
                <button onClick={() => navigator.clipboard.writeText(content)}
                  className="ml-auto rounded border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-100">📋 Copy message</button>
              </Tooltip>
              {person?.linkedin_url && (
                <Tooltip text="Opens this person's LinkedIn profile in a new tab.">
                  <a href={person.linkedin_url} target="_blank" rel="noreferrer"
                    className="rounded border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-100">Open profile ↗</a>
                </Tooltip>
              )}
            </div>
          )}
          {direction === 'out' && channel === 'email' && !canSendViaGmail && content && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
              <span className="text-gray-500">
                {gmail?.configured ? 'Gmail não ligado a este contacto (sem email verificado ou conta não ligada) — copia e envia manualmente, depois confirma abaixo.' : 'Envia manualmente a partir do teu email, depois confirma abaixo para o registar.'}
              </span>
              <Tooltip text="Copies the subject and body so you can paste them into your email client.">
                <button onClick={() => navigator.clipboard.writeText(subject ? `Subject: ${subject}\n\n${content}` : content)}
                  className="ml-auto rounded border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-100">📋 Copy</button>
              </Tooltip>
            </div>
          )}
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
          <div className="mt-2">
            <label className="text-xs text-gray-500">Tipo de compromisso {!actionTypeTouched && entityId && '(recomendado)'}</label>
            <select value={nextActionType}
              onChange={(e) => { setNextActionType(e.target.value as ActionType); setActionTypeTouched(true); }}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm sm:w-auto">
              {ACTION_TYPES.map((at) => <option key={at} value={at}>{ACTION_TYPE_LABEL[at]}</option>)}
            </select>
          </div>
          {hookNotResearched && (
            <div className="mt-2 rounded border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900">
              Hook não researched — pesquisar antes de contactar. (regra existente: nunca rascunhar sem hook researched)
            </div>
          )}
        </Card>

        {reopenTrigger && direction === 'out' && (
          <Card title="Reabertura — cite o &ldquo;não&rdquo; anterior e o que mudou" tint="amber">
            <p className="text-sm text-amber-900">{reopenTrigger}</p>
            <label className="mt-2 flex items-start gap-2 text-xs text-amber-800">
              <input type="checkbox" checked={reopenAck} onChange={(e) => setReopenAck(e.target.checked)} className="mt-0.5" />
              <span>O rascunho cita o pass anterior e o que mudou, conforme a doutrina de reabertura.</span>
            </label>
          </Card>
        )}

        <div>
          {toast && <div className="mb-2 rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">{toast}</div>}
          {sendErr && <div className="mb-2 rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-[#B00000]">{sendErr}</div>}
          {direction === 'in' || summary.green ? (
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip text={needsManualSendConfirmation
                ? 'Confirms you sent this yourself outside the app, then logs it and applies its follow-on effects (contact lock, follow-up task).'
                : 'Logs this interaction and applies its follow-on effects (contact lock, next-step task).'}>
                <button disabled={!formReady || (direction === 'out' && lintErrors.length > 0)} onClick={() => save(false)}
                  className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                  {primarySaveLabel}
                </button>
              </Tooltip>
              {canSendViaGmail && (
                <Tooltip text="Sends the email through your connected Gmail account, then logs it automatically.">
                  <button disabled={sending || !formReady || lintErrors.length > 0} onClick={sendViaGmail}
                    className="rounded-lg border border-[#0E7490] px-4 py-2 text-sm font-medium text-[#0E7490] disabled:opacity-40">
                    {sending ? 'Sending…' : `Send from ${gmail?.email} & log`}
                  </button>
                </Tooltip>
              )}
            </div>
          ) : blockedHard ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-[#B00000]">
              Blocked: {summary.blocked ? 'a non-overridable pre-flight check failed.' : 'fix the linter errors above.'}
            </div>
          ) : needsOverride && !showOverride ? (
            <Tooltip text="Proceed despite the failed checks — requires a written justification, logged to the audit trail.">
              <button disabled={!formReady || lintErrors.length > 0} onClick={() => setShowOverride(true)}
                className="rounded-lg border border-amber-500 px-4 py-2 text-sm font-medium text-amber-700 disabled:opacity-40">
                Override & save… ({summary.failed.length} check{summary.failed.length > 1 ? 's' : ''} failed)
              </button>
            </Tooltip>
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
                      <Tooltip text={PREFLIGHT_EXPLAIN[c.key] ?? c.label} side="right">
                        <span className={c.ok ? 'text-gray-600' : 'font-medium'}>{c.label}</span>
                      </Tooltip>
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
