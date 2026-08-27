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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { Tooltip, PREFLIGHT_EXPLAIN } from '@/components/ui';
import { lintMessage, preflight, preflightSummary } from '@/lib/rules';
import { nextContactPerson, PASS_REASON_CATEGORIES } from '@/lib/relationship';
import { authEnabled } from '@/lib/supabase';
import { uploadAndVerifyFile } from '@/lib/vault-upload-client';
import type { Channel, Classification, DocumentItem, Entity, Folder, OverrideRule, PassReasonCategory } from '@/lib/types';

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
  const { db, logInteraction, addDocument, addGrant } = useStore();
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
  // Prompt 397 §C — attachments picked in THIS draft, not yet saved. Each is
  // exactly one document OR folder (mirrors AccessGrant/InteractionDocument).
  // Sharing (options 2/3 below) creates the access grant immediately, at the
  // moment of picking — not deferred to Save — same "additive, revoke is a
  // separate action elsewhere" precedent the documents page's own grant flow
  // already follows; removing the chip here only removes the attachment
  // link, never the grant it may have already created.
  const [attachments, setAttachments] = useState<{ documentId?: string; folderId?: string; label: string; origin: string }[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachSubmenu, setAttachSubmenu] = useState<'document' | 'folder' | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachErr, setAttachErr] = useState('');
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prompt 397 §C.1.2 — same dropdown pattern as RelationshipSummaryCard's
  // own menus: absolute, closes on Escape or a click outside.
  useEffect(() => {
    if (!attachMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) { setAttachMenuOpen(false); setAttachSubmenu(null); }
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { setAttachMenuOpen(false); setAttachSubmenu(null); } }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [attachMenuOpen]);

  // §C.2 — reuses the documents page's own addGrant exactly (same shape:
  // person_id + document_id XOR folder_id, nda_required false here — the
  // Log panel doesn't offer an NDA step); §C.2.2 dedups against any
  // still-active grant already covering this exact (person, target).
  function ensureGrant(target: { documentId?: string; folderId?: string }) {
    if (!personId) return;
    const already = db.grants.some((g) => !g.revoked_at && g.person_id === personId
      && (target.documentId ? g.document_id === target.documentId : g.folder_id === target.folderId));
    if (already) return;
    addGrant({ person_id: personId, document_id: target.documentId, folder_id: target.folderId, nda_required: false });
  }

  function attachExistingDocument(doc: DocumentItem) {
    ensureGrant({ documentId: doc.id });
    setAttachments((prev) => [...prev, { documentId: doc.id, label: doc.name, origin: 'Vault · view-only' }]);
    setAttachMenuOpen(false); setAttachSubmenu(null);
  }

  function attachExistingFolder(folder: Folder) {
    ensureGrant({ folderId: folder.id });
    setAttachments((prev) => [...prev, { folderId: folder.id, label: folder.name, origin: 'folder · full access' }]);
    setAttachMenuOpen(false); setAttachSubmenu(null);
  }

  // §C.2.3 — upload alone creates no grant (a decision, not a rule fork:
  // /log's own "Material shared" field never granted access either — it
  // only ever linked a document that was ALREADY shared through the Vault's
  // own grant flow). Sharing the freshly uploaded document is a second,
  // explicit step: reopen Attach → Share a Vault document, now that it
  // exists. Reuses documents/page.tsx's exact upload path (uploadAndVerifyFile
  // + addDocument, is_view_only/visibility/watermark/downloadable all the
  // same), read in full before writing this, never a second upload route.
  async function attachFromComputer(file: File) {
    setAttaching(true); setAttachErr('');
    try {
      const folderId = db.folders.find((f) => f.name === 'Investor deck')?.id ?? db.folders[0]?.id;
      if (!folderId) throw new Error('No Vault folder exists yet — add one on the Documents page first.');
      const verified = await uploadAndVerifyFile(db.org.id, file);
      const docId = addDocument({
        folder_id: folderId, name: file.name, storage_path: verified.storagePath,
        is_view_only: true, visibility: 'on_grant', watermark: false, downloadable: false,
        malware_scan_status: verified.malwareScanStatus as DocumentItem['malware_scan_status'],
      });
      setAttachments((prev) => [...prev, { documentId: docId, label: file.name, origin: 'from this computer' }]);
      setAttachMenuOpen(false); setAttachSubmenu(null);
    } catch (e) {
      setAttachErr((e as Error).message);
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

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
      attachments: attachments.length ? attachments.map((a) => ({ documentId: a.documentId, folderId: a.folderId })) : undefined,
    });
    setToast(direction === 'out' ? `Saved. Contact lock set for 14 days.${overrides.length ? ' Override logged.' : ''}` : 'Reply saved.');
    setContent(''); setClassification(''); setPassReason(''); setJustification(''); setShowOverride(false); setReopenAck(false);
    setAttachments([]);
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

      <div>
        <div className="flex items-center gap-1">
          <label className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Attachments</label>
          <AttachHint />
        </div>
        {attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {attachments.map((a, i) => (
              <span key={i} className="inline-flex max-w-full items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-700">
                <span aria-hidden>{a.documentId ? '📄' : '📁'}</span>
                <span className="max-w-[130px] truncate">{a.label}</span>
                <span className="whitespace-nowrap text-gray-400">· {a.origin}</span>
                <button type="button" onClick={() => removeAttachment(i)} title="Remove"
                  className="text-gray-400 hover:text-[#B00000]">✕</button>
              </span>
            ))}
          </div>
        )}
        <div ref={attachMenuRef} className="relative mt-1.5 inline-block">
          <button type="button" onClick={() => setAttachMenuOpen((o) => !o)} disabled={attaching}
            className="rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:border-[#0E7490] hover:text-[#0E7490] disabled:opacity-50">
            {attaching ? 'Uploading…' : '📎 Attach'}
          </button>
          {attachMenuOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
              {attachSubmenu === null && (
                <>
                  <button type="button" disabled={!authEnabled} onClick={() => fileInputRef.current?.click()}
                    className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">
                    <div className="text-xs font-medium text-gray-800">Attach from this computer</div>
                    <div className="text-[11px] text-gray-400">
                      {authEnabled ? 'uploads the file into your Vault first' : 'needs a live Supabase connection — unavailable in demo mode'}
                    </div>
                  </button>
                  <button type="button" disabled={!personId} onClick={() => setAttachSubmenu('document')}
                    className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">
                    <div className="text-xs font-medium text-gray-800">Share a Vault document</div>
                    <div className="text-[11px] text-gray-400">one file, view-only</div>
                  </button>
                  <button type="button" disabled={!personId} onClick={() => setAttachSubmenu('folder')}
                    className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">
                    <div className="text-xs font-medium text-gray-800">Grant access to a Vault folder</div>
                    <div className="text-[11px] text-gray-400">the whole folder, revocable</div>
                  </button>
                  {!personId && (
                    <p className="border-t border-gray-100 px-2 pt-1.5 text-[11px] text-amber-700">Select a person first to share Vault access.</p>
                  )}
                  <p className="mt-1 flex items-start gap-1 border-t border-gray-100 px-2 pt-1.5 text-[10.5px] leading-snug text-gray-400">
                    <span aria-hidden>🛡</span>
                    <span>New shares are recorded in the Vault as access grants — &ldquo;Access grants — the owner consents, access follows&rdquo; → Granted so far.</span>
                  </p>
                </>
              )}
              {attachSubmenu === 'document' && (
                <div>
                  <button type="button" onClick={() => setAttachSubmenu(null)} className="px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-[#0E7490]">← Back</button>
                  <ul className="max-h-52 overflow-y-auto">
                    {db.documents.length === 0 && <li className="px-2 py-1.5 text-xs text-gray-400">No documents in the Vault yet.</li>}
                    {db.documents.map((d) => (
                      <li key={d.id}>
                        <button type="button" onClick={() => attachExistingDocument(d)}
                          className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50">
                          {d.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {attachSubmenu === 'folder' && (
                <div>
                  <button type="button" onClick={() => setAttachSubmenu(null)} className="px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-[#0E7490]">← Back</button>
                  <ul className="max-h-52 overflow-y-auto">
                    {db.folders.length === 0 && <li className="px-2 py-1.5 text-xs text-gray-400">No folders in the Vault yet.</li>}
                    {db.folders.map((f) => (
                      <li key={f.id}>
                        <button type="button" onClick={() => attachExistingFolder(f)}
                          className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50">
                          {f.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        <input ref={fileInputRef} type="file" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachFromComputer(f); }} />
        {attachErr && <p className="mt-1 text-[11px] text-[#B00000]">{attachErr}</p>}
      </div>

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

// Prompt 397 §C.4 — hover (and focus, for keyboard), never always-visible:
// deliberately NOT TermHint (ui.tsx), which toggles on click — a different,
// shared component whose own behavior stays untouched for its other callers.
function AttachHint() {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <button type="button" tabIndex={0} aria-label="How sharing works" onFocus={() => setShow(true)} onBlur={() => setShow(false)}
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-current text-[9px] font-bold leading-none text-gray-400 opacity-70 hover:opacity-100">
        i
      </button>
      {show && (
        <span role="tooltip"
          className="pointer-events-none absolute z-50 bottom-full left-1/2 mb-1.5 w-max max-w-[230px] -translate-x-1/2 rounded-lg bg-gray-900 px-2 py-1 text-center text-[11px] font-medium leading-snug text-white shadow-lg">
          New shares are recorded in the Vault as access grants — &ldquo;Access grants — the owner consents, access follows&rdquo; → Granted so far.
        </span>
      )}
    </span>
  );
}
