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
import type { EditorTab } from '@/lib/calls/lifecycle';
import { callsApi, type CallState } from './api';
import { GeneralTab, type GeneralPatch } from './GeneralTab';
import { PhasesTab, type PhaseDraft } from './PhasesTab';
import { FormTab } from './FormTab';
import { PreviewTab, type LifecycleAction } from './PreviewTab';
import { SaveStatus, type SaveState } from './SaveStatus';
import { StatusBadge } from './StatusBadge';

type Section = 'general' | 'phases' | 'form';
const DEBOUNCE_MS = 700;

const TABS: { key: EditorTab | 'eligibility' | 'team' | 'evaluation'; label: string; soon?: boolean }[] = [
  { key: 'general', label: 'General' },
  { key: 'phases', label: 'Phases' },
  { key: 'form', label: 'Form' },
  { key: 'eligibility', label: 'Eligibility', soon: true },
  { key: 'team', label: 'Team & distribution', soon: true },
  { key: 'evaluation', label: 'Evaluation', soon: true },
  { key: 'preview', label: 'Preview & confirm' },
];

export function CallEditor({ callId, onBack }: { callId: string; onBack: () => void }) {
  const [server, setServer] = useState<CallState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [call, setCall] = useState<Call | null>(null);
  const [phases, setPhases] = useState<PhaseDraft[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  const [tab, setTab] = useState<EditorTab>('general');
  const [save, setSave] = useState<{ state: SaveState; message?: string }>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

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

  async function act(action: LifecycleAction, extra: { closesAt?: string } = {}) {
    setBusy(true); setActionError('');
    try {
      if (timer.current) clearTimeout(timer.current);
      await flush(); // never confirm over unsaved edits
      if (failed.current) { setActionError('Fix the save error first, then try again.'); return; }
      const res = await callsApi.act(callId, action, extra);
      if (!res.ok) { setActionError(res.body.error ?? 'Something went wrong. Please try again.'); if (res.body.code === 'conflict') void load(); return; }
      adopt(res.body, true);
      if (action === 'confirm' || action === 'publish') setTab('preview');
    } finally { setBusy(false); }
  }

  if (loadError) {
    return (
      <div className="max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-700">{loadError}</p>
        <button type="button" onClick={onBack} className="mt-3 text-sm font-medium text-[#0E7490] hover:underline">← Back to your calls</button>
      </div>
    );
  }
  if (!server || !call) return <p className="text-sm text-gray-400">Loading…</p>;

  const readOnly = !server.canManage || call.status !== 'draft';
  const reason = !server.canManage
    ? 'You can view this call, but only the owners and administrators of your organisation can change it.'
    : call.status === 'draft' ? null
    : call.status === 'validated' || call.status === 'scheduled' ? 'This call is confirmed, so its configuration is locked. Use “Edit configuration” in Preview & confirm to change it.'
    : 'This call is open or closed: questions and options can no longer change.';

  return (
    <div data-testid="call-editor">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => { void flush().then(onBack); }} className="text-sm text-gray-500 hover:text-[#0E7490]">← Calls</button>
          <h1 className="min-w-0 truncate text-lg font-bold text-gray-900">{call.name || 'Untitled call'}</h1>
          <StatusBadge status={server.effectiveStatus} />
        </div>
        <SaveStatus state={save.state} message={save.message} onRetry={() => void flush()} onReload={() => void load()} />
      </div>

      <div role="tablist" aria-label="Call configuration" className="mb-5 flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} disabled={t.soon}
            title={t.soon ? 'Coming in the next stage' : undefined}
            onClick={() => !t.soon && setTab(t.key as EditorTab)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.key ? 'border-[#0E7490] font-semibold text-[#0E7490]' : t.soon ? 'cursor-not-allowed border-transparent text-gray-300' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
            {t.label}{t.soon && <span className="ml-1 text-[9px] font-normal uppercase tracking-wide">soon</span>}
          </button>
        ))}
      </div>

      {reason && <p role="status" className="mb-4 rounded-lg bg-sky-50 px-4 py-2.5 text-xs text-sky-900" data-testid="lock-reason">{reason}</p>}

      {tab === 'general' && <GeneralTab call={call} promoterName={server.promoterName} disabled={readOnly} onChange={editGeneral} />}
      {tab === 'phases' && <PhasesTab phases={phases} disabled={readOnly} onChange={editPhases} />}
      {tab === 'form' && <FormTab fields={fields} disabled={readOnly} onChange={editFields} />}
      {tab === 'preview' && (
        <PreviewTab
          call={call} effectiveStatus={server.effectiveStatus} phases={server.phases} fields={fields} issues={server.issues} summary={server.summary}
          actions={server.actions} canManage={server.canManage} busy={busy} error={actionError}
          origin={typeof window !== 'undefined' ? window.location.origin : ''}
          onJump={setTab} onAction={(a, extra) => void act(a, extra)}
        />
      )}
    </div>
  );
}
