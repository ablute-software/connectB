'use client';
// Prompt 905 — the Calls editor: tabs General · Phases · Form · Eligibility · Team & distribution · Evaluation ·
// Preview & confirm. Everything AUTOSAVES (spec §14.1): edits show at once, a debounced save follows, and the
// indicator says "Saving…", "Saved" or "Save error" — never "Saved" before the server confirmed. Saves are queued
// (one in flight) under optimistic concurrency: each carries the version it is based on, and a conflict or a lock
// is reported instead of silently overwriting somebody else.
//
// Who may edit: only a manager of the promoting organisation, and only while the call is a draft; otherwise the
// editor is read-only and says why.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Call, FormField } from '@/lib/calls/types';
import { formatInZone } from '@/lib/calls/tz';
import { MAIN_TABS, navQuery, parseLinkQuery, resolveNav, stepStates, type MainTab, type Nav, type StepKey } from '@/lib/calls/editor-nav';
import { callsApi, type CallState } from './api';
import { ComingNext, SetupShell } from './SetupShell';
import { GeneralTab, type GeneralPatch } from './GeneralTab';
import { PhasesTab, type PhaseDraft } from './PhasesTab';
import { FormTab } from './FormTab';
import { PreviewTab, type LifecycleAction } from './PreviewTab';
import { SaveStatus, type SaveState } from './SaveStatus';
import { StatusBadge } from './StatusBadge';
import { CallDangerZone } from './CallDangerZone';
import { TeamTab } from './TeamTab';
import { SubmissionsTab } from './SubmissionsTab';
import { ContactEmailField } from './ContactEmailField';
import { ImportFromDocuments, type ApplyOutcome } from './ImportFromDocuments';
import { useImportStatus } from './useImportStatus';
import { SourceDocumentsPanel } from './SourceDocumentsPanel';
import type { ProposalFieldItem, ProposalGeneral, ProposalPhaseItem } from '@/lib/calls/ai-import/proposal';
import type { ImportOutcome } from './ImportFormDialog';
import type { ImportMode } from '@/lib/calls/form-import';

type Section = 'general' | 'phases' | 'form';
const DEBOUNCE_MS = 700;

export function CallEditor({ callId, onBack, startImport = false, startRunId = null }: { callId: string; onBack: () => void; startImport?: boolean; startRunId?: string | null }) {
  const [server, setServer] = useState<CallState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [call, setCall] = useState<Call | null>(null);
  const [phases, setPhases] = useState<PhaseDraft[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  // Prompt 918 (I1): four tabs, and the steps of Setup. `nav` is decided when the call has loaded (a link may say where; otherwise a draft opens on Setup, a published call on
  // Applications). `jump` is a field to scroll to and focus once its step is on screen ("What is missing" → the field).
  const [nav, setNav] = useState<Nav | null>(null);
  // What the address said when the editor opened, read ONCE (the editor rewrites the address as the person moves around, and cleans it when it closes).
  const linkQuery = useRef<ReturnType<typeof parseLinkQuery> | null>(null);
  if (linkQuery.current === null && typeof window !== 'undefined') linkQuery.current = parseLinkQuery(window.location.search, callId);
  const [jump, setJump] = useState<{ target: string; n: number } | null>(null);
  const [save, setSave] = useState<{ state: SaveState; message?: string }>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  // Prompt 909 (I4): the import from documents dialog (opened from Form, from General, or when a call is created from documents).
  const [importDocs, setImportDocs] = useState(startImport);
  // The proposal the dialog opens ON (from "Review" / the pill); null = the upload form.
  const [importRunId, setImportRunId] = useState<string | null>(startRunId);
  const [docsReload, setDocsReload] = useState(0);
  // Prompt 909 (Adenda 2b): a reading in progress, or a proposal waiting for review, shown next to the Import buttons.
  const { status: importStatus, runId: pendingRunId } = useImportStatus(callId, docsReload);
  const reviewProposal = () => { setImportRunId(pendingRunId); setImportDocs(true); };

  // The latest local values and the save machinery live in refs: a save in flight must see edits made meanwhile.
  const callRef = useRef<Call | null>(null);
  const phasesRef = useRef<PhaseDraft[]>([]);
  const fieldsRef = useRef<FormField[]>([]);
  const generalPatch = useRef<GeneralPatch>({});
  const dirty = useRef<Record<Section, boolean>>({ general: false, phases: false, form: false });
  const version = useRef(0);
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failed = useRef(false);

  const adopt = useCallback((s: CallState, replaceLocal: boolean) => {
    version.current = s.call.configVersion;
    setServer(s);
    if (replaceLocal) {
      callRef.current = s.call; phasesRef.current = s.phases.map(({ id, name, startsOn, endsOn }) => ({ id, name, startsOn, endsOn })); fieldsRef.current = s.fields;
      setCall(s.call); setPhases(phasesRef.current); setFields(s.fields);
    } else {
      // Keep what the person typed; take only what the server alone knows.
      setCall((c) => (c ? { ...c, configVersion: s.call.configVersion, status: s.call.status, linkToken: s.call.linkToken, validatedAt: s.call.validatedAt } : s.call));
    }
  }, []);

  const load = useCallback(async () => {
    const res = await callsApi.get(callId);
    if (!res.ok) { setLoadError(res.status === 404 ? 'This call does not exist, or you do not have access to it.' : res.body.error ?? 'Could not load the call.'); return; }
    dirty.current = { general: false, phases: false, form: false }; generalPatch.current = {};
    failed.current = false;               // what failed to save is gone with the reload: nothing is left to be fixed (this flag used to outlive it and refuse every action afterwards, in silence)
    setSave({ state: 'idle' }); setActionError('');
    adopt(res.body, true);
  }, [callId, adopt]);
  useEffect(() => { void load(); }, [load]);

  const flush = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const section = (['general', 'phases', 'form'] as Section[]).find((s) => dirty.current[s]);
        if (!section) break;
        dirty.current[section] = false; // edits made while this request runs set it again
        setSave({ state: 'saving' });
        const id = callRef.current!.id;
        const res = section === 'general'
          ? await (async () => { const p = generalPatch.current; generalPatch.current = {}; return callsApi.patchGeneral(id, version.current, p as Record<string, unknown>); })()
          : section === 'phases' ? await callsApi.putPhases(id, version.current, phasesRef.current)
          : await callsApi.putForm(id, version.current, fieldsRef.current);

        if (!res.ok) {
          dirty.current[section] = true; failed.current = true;
          if (res.body.code === 'conflict') setSave({ state: 'conflict', message: res.body.error });
          else if (res.body.code === 'locked') { setSave({ state: 'error', message: res.body.error }); void load(); }
          else setSave({ state: 'error', message: res.body.error });
          break;
        }
        failed.current = false;
        // Adopt the server's tidied version of a section only when nothing newer was typed in it meanwhile.
        const s = res.body;
        version.current = s.call.configVersion;
        setServer(s);
        if (!dirty.current.form && section === 'form') { fieldsRef.current = s.fields; setFields(s.fields); }
        if (!dirty.current.phases && section === 'phases') { const p = s.phases.map(({ id: pid, name, startsOn, endsOn }) => ({ id: pid, name, startsOn, endsOn })); phasesRef.current = p; setPhases(p); }
        setCall((c) => (c ? { ...c, configVersion: s.call.configVersion } : s.call));
        if (callRef.current) callRef.current = { ...callRef.current, configVersion: s.call.configVersion };
        const anyDirty = dirty.current.general || dirty.current.phases || dirty.current.form;
        setSave({ state: anyDirty ? 'saving' : 'saved' });
      }
    } finally { running.current = false; }
  }, [load]);

  const schedule = useCallback((section: Section) => {
    dirty.current[section] = true;
    setSave((s) => (s.state === 'saving' ? s : { state: 'dirty' }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
  }, [flush]);

  // Flush on the way out and warn if something is not saved.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty.current.general || dirty.current.phases || dirty.current.form) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); if (timer.current) clearTimeout(timer.current); void flush(); };
  }, [flush]);

  const editGeneral = (patch: GeneralPatch) => {
    callRef.current = { ...callRef.current!, ...patch } as Call; setCall(callRef.current);
    generalPatch.current = { ...generalPatch.current, ...patch };
    schedule('general');
  };
  const editPhases = (next: PhaseDraft[]) => { phasesRef.current = next; setPhases(next); schedule('phases'); };
  const editFields = (next: FormField[]) => { fieldsRef.current = next; setFields(next); schedule('form'); };

  const goTab = (main: MainTab) => { setNav({ main, step: main === 'setup' ? nav?.step ?? 'general' : 'general' }); setJump(null); };
  function goStep(step: StepKey, target?: string) {
    setNav({ main: 'setup', step });
    setJump(target ? { target, n: Date.now() } : null);
    if (!target && typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }

  // Where the call opens: what the address says (the new section/step, or an old ?tab=), else by the call's state.
  useEffect(() => {
    if (server && !nav) setNav(resolveNav(linkQuery.current ?? {}, server.effectiveStatus));
  }, [server, nav]);
  // The address follows what is shown, so a reload (or a copied link) lands in the same place; and it is cleaned when the editor closes.
  useEffect(() => {
    if (!nav) return;
    const u = new URL(window.location.href);
    const q = navQuery(nav);
    u.searchParams.set('call', callId); u.searchParams.set('section', q.section);
    if (q.step) u.searchParams.set('step', q.step); else u.searchParams.delete('step');
    window.history.replaceState(window.history.state, '', u);
  }, [nav, callId]);
  useEffect(() => () => {
    const u = new URL(window.location.href);
    for (const k of ['call', 'section', 'step']) u.searchParams.delete(k);
    window.history.replaceState(window.history.state, '', u);
  }, []);
  // "What is missing" → the field: once the step is on screen, scroll to it and put the cursor there.
  useEffect(() => {
    if (!jump) return;
    const id = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-jump="${CSS.escape(jump.target)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (el.matches('input, textarea, select, button')) el.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(id);
  }, [jump]);

  async function act(action: LifecycleAction, extra: { closesAt?: string; confirmEarly?: boolean } = {}) {
    setBusy(true); setActionError(''); setActionNotice('');
    try {
      if (timer.current) clearTimeout(timer.current);
      await flush(); // never confirm over unsaved edits
      // Confirming, publishing and editing the configuration are ABOUT what is saved: they wait for a clean save. Reopening, extending, closing and archiving are not — they never touch the
      // form, so a save that failed earlier (typically a locked field of a call that already opened) must not hold them back (Prompt 918, Adenda 3: "Reopen and extend" did nothing, in silence).
      const aboutTheForm = action === 'confirm' || action === 'publish' || action === 'edit';
      const unsaved = dirty.current.general || dirty.current.phases || dirty.current.form;
      if (failed.current && !unsaved) failed.current = false;
      if (failed.current && aboutTheForm) { setActionError('Fix the save error first, then try again.'); return; }
      const res = await callsApi.act(callId, action, extra);
      if (!res.ok) { setActionError(res.body.error ?? 'Something went wrong. Please try again.'); if (res.body.code === 'conflict') void load(); return; }
      adopt(res.body, true);
      if (action === 'reopen') setActionNotice(`The call is open again${res.body.call.closesAt ? ` until ${formatInZone(res.body.call.closesAt, res.body.call.timezone)}` : ''}. Applicants who had not submitted can submit; what was submitted is untouched.`);
      if (action === 'confirm' || action === 'publish') goStep('review');
    } finally { setBusy(false); }
  }

  /** Apply what was ACCEPTED from an import proposal (Prompt 909, I4): never over unsaved edits; the server's state replaces the local one. */
  async function applyImport(runId: string, accepted: { general?: ProposalGeneral; phases?: ProposalPhaseItem[]; fields?: ProposalFieldItem[] }, fieldsMode: 'add' | 'replace'): Promise<ApplyOutcome> {
    if (timer.current) clearTimeout(timer.current);
    await flush();
    if (failed.current) return { ok: false, error: 'Fix the save error first, then try again.' };
    const res = await callsApi.applyImport(callId, runId, { baseVersion: version.current, fieldsMode, accepted });
    if (!res.ok) {
      if (res.body.code === 'conflict') void load();
      return { ok: false, error: res.body.error ?? 'Could not apply the accepted items.' };
    }
    adopt(res.body, true);
    setDocsReload((n) => n + 1);
    const a = res.body.applied;
    return { ok: true, summary: `Applied: ${[a.general ? 'General' : '', a.phases ? `${a.phases} phase${a.phases === 1 ? '' : 's'}` : '', a.fields ? `${a.fields} question${a.fields === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')}.` };
  }

  /** Import the form of another call (Prompt 909, I2): never over unsaved edits; the server's form replaces the local one. */
  async function importForm(sourceCallId: string, mode: ImportMode, confirmReplace: boolean): Promise<ImportOutcome> {
    if (timer.current) clearTimeout(timer.current);
    await flush();
    if (failed.current) return { ok: false, error: 'Fix the save error first, then try again.' };
    const res = await callsApi.importForm(callId, { sourceCallId, mode, baseVersion: version.current, confirmReplace });
    if (!res.ok) {
      if (res.body.code === 'conflict') void load();
      return { ok: false, code: res.body.code, error: res.body.error ?? 'Could not import the form.' };
    }
    adopt(res.body, true);
    const { imported, from, warnings } = res.body.import;
    return { ok: true, summary: `Imported ${imported} field${imported === 1 ? '' : 's'} from “${from}”.${warnings.length ? ` ${warnings.join(' ')}` : ''}` };
  }

  /** The call was deleted (Prompt 918, Adenda 2, C: the dialog asked for its name and the server did it) — nothing left to save; back to the list. */
  function afterDeleted() {
    if (timer.current) clearTimeout(timer.current);
    dirty.current = { general: false, phases: false, form: false };
    onBack();
  }

  if (loadError) {
    return (
      <div className="max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-700">{loadError}</p>
        <button type="button" onClick={onBack} className="mt-3 text-sm font-medium text-[#0E7490] hover:underline">← Back to your calls</button>
      </div>
    );
  }
  if (!server || !call || !nav) return <p className="text-sm text-gray-400">Loading…</p>;

  const readOnly = !server.canManage || call.status !== 'draft';
  const reason = !server.canManage
    ? 'You can view this call, but you do not have the “Configure call” permission on it. Ask the call’s administrators.'
    : call.status === 'draft' ? null
    : call.status === 'validated' || call.status === 'scheduled' ? 'This call is validated, so its configuration is locked. Use “Edit configuration” in Review & publish to change it. The description, cover image and logo can still be changed.'
    : 'This call is open or closed: questions and options can no longer change. The description, cover image and logo can still be changed.';

  return (
    <div data-testid="call-editor" data-calls-touch>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => { void flush().then(onBack); }} className="text-sm text-gray-500 hover:text-[#0E7490]">← Calls</button>
          <h1 className="min-w-0 truncate text-lg font-bold text-gray-900">{call.name || 'Untitled call'}</h1>
          <StatusBadge status={server.effectiveStatus} />
        </div>
        <SaveStatus state={save.state} message={save.message} onRetry={() => void flush()} onReload={() => void load()} />
      </div>

      <div role="tablist" aria-label="Call" className="mb-5 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-gray-200" data-testid="main-tabs">
        {MAIN_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={nav.main === t.key} data-testid={`tab-${t.key}`} onClick={() => goTab(t.key)}
            className={`-mb-px min-h-[44px] shrink-0 border-b-2 px-4 py-2 text-sm ${nav.main === t.key ? 'border-[#0E7490] font-semibold text-[#0E7490]' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {nav.main === 'setup' && reason && <p role="status" className="mb-4 rounded-lg bg-sky-50 px-4 py-2.5 text-xs text-sky-900" data-testid="lock-reason">{reason}</p>}

      {nav.main === 'applications' && <SubmissionsTab callId={callId} timezone={call.timezone} currency={call.currency} />}
      {nav.main === 'evaluation' && <ComingNext testId="evaluation-soon" title="Evaluation" text="Coming in the next stage. Here the team will evaluate the applications with the grid you set up." />}
      {nav.main === 'results' && <ComingNext testId="results-soon" title="Results" text="Coming in the next stage. Here you will see the ranking and publish the results." />}

      {nav.main === 'setup' && (
        <SetupShell step={nav.step} onStep={(s) => goStep(s)}
          states={stepStates({ call, phases: server.phases, fields, issues: server.issues, teamMembers: server.teamMembers ?? 0 })}>
          {nav.step === 'general' && (
            <>
              <GeneralTab call={call} promoterName={server.promoterName} disabled={readOnly} presentationDisabled={!server.canManage || call.status === 'archived'} branding={server.branding}
                onState={(s) => adopt(s, false)} onChange={editGeneral} />
              <ContactEmailField callId={callId} initial={call.contactEmail ?? null} canConfigure={server.canManage} />
              <SourceDocumentsPanel callId={callId} canConfigure={server.canManage} locked={readOnly} reloadKey={docsReload} onImport={() => { setImportRunId(null); setImportDocs(true); }} importStatus={importStatus} onReview={reviewProposal} />
              <CallDangerZone callId={callId} name={call.name} actions={server.actions} status={server.effectiveStatus}
                canManage={server.canManage} busy={busy} onDeleted={afterDeleted} onArchive={() => void act('archive')} />
              {actionError && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-[#B00000]">{actionError}</p>}
            </>
          )}
          {nav.step === 'phases' && <PhasesTab phases={phases} disabled={readOnly} onChange={editPhases} />}
          {nav.step === 'form' && <FormTab callId={callId} fields={fields} disabled={readOnly} lockedReason={reason} onChange={editFields} onImport={importForm} onImportDocuments={() => { setImportRunId(null); setImportDocs(true); }} importStatus={importStatus} onReview={reviewProposal} selectId={jump?.target} selectKey={jump?.n} />}
          {nav.step === 'eligibility' && <ComingNext testId="eligibility-soon" title="Eligibility rules" text="Coming next. Here you will say who is eligible, rule by rule, tied to the questions and documents of your form." />}
          {nav.step === 'team' && <TeamTab callId={callId} />}
          {nav.step === 'grid' && <ComingNext testId="grid-soon" title="Evaluation grid" text="Coming in the next stage. The grid the evaluators will use is set up here." />}
          {nav.step === 'review' && (
            <PreviewTab
              call={call} effectiveStatus={server.effectiveStatus} phases={server.phases} fields={fields} issues={server.issues} summary={server.summary}
              actions={server.actions} canManage={server.canManage} busy={busy} error={actionError} notice={actionNotice} closedReason={server.closedReason ?? null}
              origin={typeof window !== 'undefined' ? window.location.origin : ''}
              onJump={goStep} onAction={(a, extra) => void act(a, extra)}
            />
          )}
        </SetupShell>
      )}

      {importDocs && (
        <ImportFromDocuments callId={callId} timezone={call.timezone} currentFieldCount={fields.length}
          openRunId={importRunId} onClose={() => { setImportDocs(false); setImportRunId(null); setDocsReload((n) => n + 1); }} onApply={applyImport} />
      )}
    </div>
  );
}
