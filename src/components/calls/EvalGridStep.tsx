'use client';
// Prompt 922 (I1) — Setup → "Evaluation grid". Sections (optional) and criteria, each with a name, guidance for the evaluator, a WEIGHT, a SCALE the entity chooses (shortcuts 1–5, 1–10, 0–10, or custom; a different
// scale per criterion if wanted), a description per level or range, "comment required", and an optional eliminatory minimum that only FLAGS. The sum of the weights is live and the step stays ⚠ until it is 100 %.
// A grid can be read from a document (PDF, Word, Excel) by the platform's own reader — "Read on our platform only. Evaluation grids are never sent to an AI provider." — each criterion showing where it came from;
// it can be saved as a template of the organisation and started from one (a copy); the settings (how many evaluators per application, blind evaluation, divergence, deadlines) are here too. Nothing is a browser
// dialog: confirmations are in the page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SCALE_PRESETS, gradeText, levelsToText, presetKeyOf, scaleLevels, textToLevels, weightedGrade, weightsLine, MAX_SCALE_LEVELS, type Criterion, type GridSettings,
} from '@/lib/calls/eval-grid';
import { GRID_NOTICE_TEXT } from '@/lib/calls/eval-grid-text';
import type { GridView } from '@/lib/calls/eval-grid-view';
import type { GridProposal } from '@/lib/calls/eval-grid-reader';
import { callsApi } from './api';
import { AutoTextarea } from './AutoTextarea';
import { EvaluatorPreview } from './EvaluatorPreview';
import { ScrollTabs } from '@/components/ScrollTabs';

const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-500';
const BTN = 'min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';
const PRIMARY = 'min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40 sm:min-h-0';

type Draft = Omit<Criterion, 'weight' | 'minScore'> & { weight: string; minScore: string; levelsText: string; source?: { line: number; text: string } };
/** A v4 id for a new criterion — randomUUID exists only in a secure context (https, localhost); over plain http there is getRandomValues only. */
const newId = (): string => {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const fresh = (scale = { min: 1, max: 5 }): Draft => ({ id: newId(), section: null, position: 0, name: '', guidance: '', weight: '', format: 'scale', scaleMin: scale.min, scaleMax: scale.max, levels: [], commentRequired: false, minScore: '', levelsText: '' });
const toDraft = (c: Criterion, source?: Draft['source']): Draft => ({ ...c, weight: String(c.weight), minScore: c.minScore === null ? '' : String(c.minScore), levelsText: levelsToText(c.levels), ...(source ? { source } : {}) });
const toPayload = (d: Draft) => ({ id: d.id, section: d.section, name: d.name, guidance: d.guidance, weight: d.weight === '' ? NaN : Number(d.weight), format: 'scale', scaleMin: d.scaleMin, scaleMax: d.scaleMax, levels: textToLevels(d.levelsText), commentRequired: d.commentRequired, minScore: d.minScore === '' ? null : Number(d.minScore) });
const asCriterion = (d: Draft): Criterion => ({ ...d, weight: Number(d.weight) || 0, minScore: d.minScore === '' ? null : Number(d.minScore), levels: textToLevels(d.levelsText) });

export function EvalGridStep({ callId, canManage, onCriteriaChanged }: { callId: string; canManage: boolean; onCriteriaChanged: (count: number) => void }) {
  const [view, setView] = useState<GridView | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [settings, setSettings] = useState<GridSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [templates, setTemplates] = useState<{ id: string; name: string; criteria: number }[]>([]);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ runId: string; fileName: string; notes: string[]; proposal: GridProposal } | null>(null);
  const [tab, setTab] = useState<'build' | 'preview'>('build');
  const runRef = useRef<string | null>(null);

  const apply = useCallback((v: GridView) => {
    setView(v); setDrafts(v.criteria.map((c) => toDraft(c))); setSettings(v.settings); setDirty(false); onCriteriaChanged(v.criteria.length);
  }, [onCriteriaChanged]);
  const load = useCallback(async () => {
    const [g, t] = await Promise.all([callsApi.evalGrid(callId), callsApi.evalTemplates(callId)]);
    if (!g.ok) { setError(g.body.error ?? 'Could not load the grid.'); return; }
    setError(''); apply(g.body); if (t.ok) setTemplates(t.body.templates);
  }, [callId, apply]);
  useEffect(() => { void load(); }, [load]);

  const editable = !!view && canManage && (view.mode === 'edit' || view.mode === 'versioned');
  const criteria = useMemo(() => drafts.map(asCriterion), [drafts]);
  const weights = weightsLine(criteria);
  const update = (id: string, patch: Partial<Draft>) => { setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d))); setDirty(true); };
  const setSet = (patch: Partial<GridSettings>) => { setSettings((s) => (s ? { ...s, ...patch } : s)); setDirty(true); };

  async function save(confirm = false) {
    if (!view || !settings) return;
    setBusy(true); setError('');
    const r = await callsApi.saveEvalGrid(callId, view.rev, drafts.map(toPayload), settings, confirm, runRef.current);
    setBusy(false);
    if (!r.ok) {
      if (r.body.code === 'needs_confirm') { setAsk(r.body.error ?? 'Continue?'); return; }
      if (r.body.code === 'conflict') { setError(r.body.error ?? 'Someone else changed the grid.'); void load(); return; }
      setError(r.body.error ?? 'The grid could not be saved.'); return;
    }
    setAsk(null); runRef.current = null; setImporting(null); apply(r.body);
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError('');
    const r = await callsApi.importEvalGrid(callId, file);
    setBusy(false);
    if (!r.ok) { setError(r.body.error ?? 'The file could not be read.'); return; }
    runRef.current = r.body.runId;
    const byName = new Map(r.body.proposal.criteria.map((p) => [p.name, p.source]));
    setImporting({ runId: r.body.runId, fileName: r.body.fileName, notes: r.body.proposal.notes, proposal: r.body.proposal });
    setDrafts((r.body.criteria as Criterion[]).map((c) => toDraft({ ...c, id: newId() }, byName.get(c.name)))); setDirty(true);
  }

  async function applyTemplate(id: string) {
    const r = await callsApi.copyEvalTemplate(callId, id);
    if (!r.ok) { setError(r.body.error ?? 'Could not use that template.'); return; }
    setDrafts(r.body.criteria.map((c) => toDraft(c))); setDirty(true); setImporting(null); runRef.current = null;
  }
  async function saveTemplate() {
    if (saveName === null) return;
    const r = await callsApi.saveEvalTemplate(callId, saveName);
    if (!r.ok) { setError(r.body.error ?? 'Could not save the template.'); return; }
    setSaveName(null); setTemplates(r.body.templates);
  }

  if (!view || !settings) return <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500" data-testid="grid-loading">{error || 'Loading the grid…'}</div>;

  const sections = [...new Set(drafts.map((d) => d.section ?? ''))];
  const sameSection = (a: Draft, b: Draft) => (a.section ?? '') === (b.section ?? '');
  void sameSection;

  return (
    <div className="min-w-0 space-y-4" data-testid="eval-grid-step">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Evaluation grid</h3>
        <p className="mt-1 text-xs text-gray-600">The criteria the evaluators score, with their weights. Each criterion has its own scale. A score is converted to a percentage of its own scale before the weights are applied, so criteria with different scales can be added. The grid never excludes anyone by itself.</p>
        {view.mode === 'locked' && <p className="mt-2 rounded bg-sky-50 px-2 py-1.5 text-xs text-sky-900" data-testid="grid-locked">The grid is locked while the call is confirmed. Use “Edit configuration” in Review &amp; publish to change it before the call opens.</p>}
        {view.mode === 'versioned' && <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900" data-testid="grid-frozen">{view.evaluations.submitted} evaluation{view.evaluations.submitted === 1 ? '' : 's'} already submitted: the grid is frozen (version {view.version}). Changing the criteria makes a new version; those evaluations keep theirs.</p>}
        {view.mode === 'archived' && <p className="mt-2 rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-700">An archived call cannot be changed.</p>}
        {error && <p role="alert" className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-[#B00000]" data-testid="grid-error">{error}</p>}
        <ScrollTabs label="Grid view" className="mt-3 flex gap-1 border-b border-gray-200">
          {(['build', 'preview'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} data-testid={`grid-tab-${t}`} onClick={() => setTab(t)}
            className={`-mb-px min-h-[44px] border-b-2 px-3 py-2 text-sm sm:min-h-0 ${tab === t ? 'border-[#0E7490] font-semibold text-[#0E7490]' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>{t === 'build' ? 'Build' : 'As the evaluator sees it'}</button>)}
        </ScrollTabs>
      </section>

      {tab === 'preview' ? (
        <EvaluatorPreview criteria={criteria} />
      ) : (
        <>
          {editable && (
            <section className="rounded-lg border border-[#BAD9E3] bg-[#E8F4F8] p-4" data-testid="grid-sources">
              <p className="text-sm font-semibold text-[#0E7490]">Start from a document or a template</p>
              <p className="mt-0.5 text-xs text-gray-700" data-testid="grid-privacy">{GRID_NOTICE_TEXT}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className={`${BTN} cursor-pointer`}>Import from a document (PDF, Word, Excel)<input type="file" accept=".pdf,.docx,.xlsx" className="sr-only" data-testid="grid-import-file" disabled={busy} onChange={(e) => { void chooseFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
                {templates.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-700">Start from a template
                    <select className={`${INPUT} !w-auto`} data-testid="grid-template-select" defaultValue="" onChange={(e) => { if (e.target.value) { void applyTemplate(e.target.value); e.target.value = ''; } }}>
                      <option value="">Choose…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.criteria})</option>)}
                    </select></label>
                )}
              </div>
              {importing && (
                <div className="mt-3 rounded-lg bg-white p-2.5" data-testid="grid-import-review">
                  <p className="text-sm font-medium text-gray-900">Read from “{importing.fileName}”: check each criterion below and correct what is wrong. Where each one came from is shown under it.</p>
                  {importing.notes.map((n) => <p key={n} className="mt-1 text-xs text-amber-900" data-testid="grid-import-note">{n}</p>)}
                </div>
              )}
            </section>
          )}

          <section className="space-y-3" aria-label="Criteria">
            {drafts.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500" data-testid="no-criteria">No criteria yet. Add the first one, or import a grid from a document.</p>}
            {sections.length > 1 || sections[0] ? null : null}
            {drafts.map((d, i) => (
              <CriterionCard key={d.id} d={d} index={i} total={drafts.length} editable={editable} removing={removing === d.id}
                onChange={(p) => update(d.id, p)} onMove={(dir) => { setDrafts((ds) => { const n = [...ds]; const j = i + dir; if (j < 0 || j >= n.length) return ds; [n[i], n[j]] = [n[j], n[i]]; return n; }); setDirty(true); }}
                onAskRemove={() => setRemoving(d.id)} onKeep={() => setRemoving(null)} onRemove={() => { setDrafts((ds) => ds.filter((x) => x.id !== d.id)); setRemoving(null); setDirty(true); }} />
            ))}
            {editable && <button type="button" className={PRIMARY} data-testid="add-criterion" onClick={() => { const last = drafts[drafts.length - 1]; setDrafts((ds) => [...ds, fresh(last ? { min: last.scaleMin, max: last.scaleMax } : undefined)]); setDirty(true); }} disabled={busy}>+ Add a criterion</button>}
          </section>

          <section className={`rounded-lg border p-3 ${weights.ok ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`} aria-live="polite" data-testid="grid-weights">
            <p className={`text-sm font-semibold ${weights.ok ? 'text-emerald-900' : 'text-amber-950'}`}>{weights.ok ? weights.text : `⚠ ${weights.text}`}</p>
            {!weights.ok && drafts.length > 0 && <p className="mt-0.5 text-xs text-amber-900">The grid is saved as you go, but the call cannot be confirmed until the weights add up to 100 %.</p>}
          </section>

          <SettingsPanel settings={settings} view={view} editable={editable} onChange={setSet} />

          {ask && (
            <div className="rounded-lg border border-[#0E7490] bg-white p-3" role="group" aria-label="Confirm the change" data-testid="grid-confirm">
              <p className="text-sm text-gray-800">{ask}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={busy} className={PRIMARY} data-testid="grid-confirm-yes" onClick={() => void save(true)}>{busy ? 'Saving…' : 'Yes, make the new version'}</button>
                <button type="button" disabled={busy} className={BTN} data-testid="grid-confirm-no" onClick={() => setAsk(null)}>Cancel</button>
              </div>
            </div>
          )}

          {editable && (
            <div className="flex flex-wrap items-center gap-2" data-testid="grid-actions">
              <button type="button" className={PRIMARY} disabled={busy || !dirty} data-testid="grid-save" onClick={() => void save(false)}>{busy ? 'Saving…' : 'Save the grid'}</button>
              {dirty && <span className="text-xs text-amber-900" data-testid="grid-dirty">Not saved yet</span>}
              {!dirty && drafts.length > 0 && saveName === null && <button type="button" className={BTN} data-testid="grid-save-template" onClick={() => setSaveName('')}>Save as template</button>}
            </div>
          )}
          {saveName !== null && (
            <div className="rounded-lg border border-gray-300 bg-white p-3" role="group" aria-label="Save as template" data-testid="grid-template-form">
              <label className={LABEL} htmlFor="tpl-name">Template name</label>
              <input id="tpl-name" autoComplete="off" className={INPUT} value={saveName} maxLength={120} onChange={(e) => setSaveName(e.target.value)} data-testid="grid-template-name" />
              <p className="mt-1 text-[11px] text-gray-500">A template is a grid for the whole organisation to start from. Using it makes a copy: nothing is shared afterwards.</p>
              <div className="mt-2 flex gap-2"><button type="button" className={PRIMARY} data-testid="grid-template-save" onClick={() => void saveTemplate()}>Save the template</button><button type="button" className={BTN} onClick={() => setSaveName(null)}>Cancel</button></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CriterionCard({ d, index, total, editable, removing, onChange, onMove, onAskRemove, onKeep, onRemove }: {
  d: Draft; index: number; total: number; editable: boolean; removing: boolean; onChange: (p: Partial<Draft>) => void; onMove: (dir: -1 | 1) => void; onAskRemove: () => void; onKeep: () => void; onRemove: () => void;
}) {
  const preset = presetKeyOf(d);
  const levels = scaleLevels(d);
  return (
    <article className="min-w-0 rounded-lg border border-gray-200 bg-white p-3" data-testid="criterion-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Criterion {index + 1}</span>
        {editable && (
          <span className="flex shrink-0 items-center">
            <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)} className="rounded px-2 py-1 text-gray-500 hover:text-[#0E7490] disabled:opacity-30">↑</button>
            <button type="button" aria-label="Move down" disabled={index === total - 1} onClick={() => onMove(1)} className="rounded px-2 py-1 text-gray-500 hover:text-[#0E7490] disabled:opacity-30">↓</button>
            <button type="button" aria-label="Remove criterion" data-testid="criterion-remove" onClick={onAskRemove} className="rounded px-2 py-1 text-gray-400 hover:text-[#B00000]">✕</button>
          </span>
        )}
      </div>
      {removing && (
        <div className="mb-2 rounded border border-[#B00000] p-2" role="group" aria-label="Confirm removing the criterion" data-testid="criterion-remove-confirm">
          <p className="text-xs text-gray-800">Remove “{d.name || 'this criterion'}”?</p>
          <div className="mt-1.5 flex gap-2"><button type="button" className="min-h-[44px] rounded-lg bg-[#B00000] px-3 py-1 text-sm font-semibold text-white sm:min-h-0 sm:text-xs" data-testid="criterion-remove-yes" onClick={onRemove}>Yes, remove it</button><button type="button" className={BTN} data-testid="criterion-remove-no" onClick={onKeep}>Keep</button></div>
        </div>
      )}
      <label className={LABEL} htmlFor={`cn-${d.id}`}>Name</label>
      <AutoTextarea id={`cn-${d.id}`} className={INPUT} value={d.name} disabled={!editable} maxLength={160} placeholder="e.g. Team" onChange={(name) => onChange({ name })} />
      {d.source && <p className="mt-1 text-[11px] text-gray-500 [overflow-wrap:anywhere]" data-testid="criterion-source">Read from line {d.source.line}: “{d.source.text}”</p>}
      <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <div><label className={LABEL} htmlFor={`cw-${d.id}`}>Weight (%)</label>
          <input id={`cw-${d.id}`} inputMode="decimal" autoComplete="off" className={INPUT} disabled={!editable} value={d.weight} placeholder="e.g. 25" data-testid="criterion-weight" onChange={(e) => onChange({ weight: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.').slice(0, 7) })} /></div>
        <div><label className={LABEL} htmlFor={`cs-${d.id}`}>Section (optional)</label>
          <input id={`cs-${d.id}`} autoComplete="off" className={INPUT} disabled={!editable} value={d.section ?? ''} maxLength={80} onChange={(e) => onChange({ section: e.target.value || null })} /></div>
      </div>
      <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <div className={preset === 'custom' ? 'col-span-2' : 'col-span-2'}><label className={LABEL} htmlFor={`cp-${d.id}`}>Scale</label>
          <select id={`cp-${d.id}`} className={INPUT} disabled={!editable} value={preset} data-testid="criterion-scale"
            onChange={(e) => { const p = SCALE_PRESETS.find((x) => x.key === e.target.value); if (p) onChange({ scaleMin: p.min, scaleMax: p.max, minScore: '', levelsText: '' }); else onChange({ scaleMin: d.scaleMin, scaleMax: d.scaleMax === d.scaleMin + 4 && preset !== 'custom' ? d.scaleMax + 1 : d.scaleMax }); }}>
            {SCALE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}<option value="custom">Custom…</option>
          </select></div>
        {preset === 'custom' && (
          <>
            <div><label className={LABEL} htmlFor={`cmin-${d.id}`}>Minimum</label><input id={`cmin-${d.id}`} inputMode="numeric" autoComplete="off" className={INPUT} disabled={!editable} value={d.scaleMin} data-testid="criterion-min" onChange={(e) => onChange({ scaleMin: Number(e.target.value.replace(/\D/g, '').slice(0, 3)) || 0 })} /></div>
            <div><label className={LABEL} htmlFor={`cmax-${d.id}`}>Maximum</label><input id={`cmax-${d.id}`} inputMode="numeric" autoComplete="off" className={INPUT} disabled={!editable} value={d.scaleMax} data-testid="criterion-max" onChange={(e) => onChange({ scaleMax: Number(e.target.value.replace(/\D/g, '').slice(0, 3)) || 0 })} /></div>
            {d.scaleMax - d.scaleMin + 1 > MAX_SCALE_LEVELS && <p className="col-span-2 text-xs text-[#B00000]">At most {MAX_SCALE_LEVELS} levels: the evaluator picks one with a button.</p>}
          </>
        )}
      </div>
      <label className={`${LABEL} mt-2`} htmlFor={`cg-${d.id}`}>Guidance for the evaluator</label>
      <AutoTextarea id={`cg-${d.id}`} multiline className={INPUT} value={d.guidance} disabled={!editable} maxLength={1500} onChange={(guidance) => onChange({ guidance })} />
      <details className="mt-2 rounded bg-gray-50 px-2.5 py-1.5" data-testid="criterion-levels">
        <summary className="cursor-pointer text-xs font-medium text-[#0E7490]">Describe the levels (optional){d.levelsText.trim() ? ' ✓' : ''}</summary>
        <p className="mt-1 text-[11px] text-gray-500">One line each: “{d.scaleMax}: excellent”{levels.length > 5 ? ` or a range “${d.scaleMin}–${d.scaleMin + 2}: weak”` : ''}.</p>
        <AutoTextarea id={`cl-${d.id}`} multiline ariaLabel="Descriptions of the levels" className={`${INPUT} mt-1`} value={d.levelsText} disabled={!editable} onChange={(levelsText) => onChange({ levelsText })} />
      </details>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={d.commentRequired} disabled={!editable} data-testid="criterion-comment-required" onChange={(e) => onChange({ commentRequired: e.target.checked })} /> Comment required</label>
        <label className="flex items-center gap-2 text-xs text-gray-700">Eliminatory minimum
          <select aria-label="Eliminatory minimum" className={`${INPUT} !w-auto`} disabled={!editable} value={d.minScore} data-testid="criterion-minscore" onChange={(e) => onChange({ minScore: e.target.value })}>
            <option value="">none</option>{levels.slice(1).map((l) => <option key={l} value={l}>{l}</option>)}
          </select></label>
      </div>
      {d.minScore !== '' && <p className="mt-1 text-[11px] text-gray-500">A score below {d.minScore} flags the application. It is never excluded automatically.</p>}
    </article>
  );
}

function SettingsPanel({ settings, view, editable, onChange }: { settings: GridSettings; view: GridView; editable: boolean; onChange: (p: Partial<GridSettings>) => void }) {
  const locked = view.settingsLocked;
  const all = settings.evaluatorsPerApplication === 'all';
  return (
    <section className="min-w-0 space-y-3 rounded-lg border border-gray-200 bg-white p-4" aria-label="Evaluation settings" data-testid="grid-settings">
      <h4 className="text-sm font-semibold text-gray-900">How the evaluation runs</h4>
      <div>
        <label className={LABEL} htmlFor="set-n">Evaluators per application</label>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <input id="set-n" inputMode="numeric" autoComplete="off" className={`${INPUT} !w-24`} disabled={!editable || all} value={all ? '' : String(settings.evaluatorsPerApplication)} data-testid="set-evaluators"
            onChange={(e) => onChange({ evaluatorsPerApplication: Math.max(1, Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || 1) })} />
          <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={all} disabled={!editable} data-testid="set-all" onChange={(e) => onChange({ evaluatorsPerApplication: e.target.checked ? 'all' : 2 })} /> All evaluators evaluate every application</label>
        </div>
        <p className="mt-1 text-[11px] text-gray-500">There is no maximum. If more are asked than the team has (people with “Evaluate assigned applications”), the distribution tells you and uses everyone available.</p>
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-800"><input type="checkbox" className="mt-1" checked={settings.blind} disabled={!editable || locked} data-testid="set-blind" onChange={(e) => onChange({ blind: e.target.checked })} />
        <span><b>Blind evaluation.</b> The evaluator does not see who applied: the startup, the people and their emails. You always see everything.{locked ? ' (Locked: an evaluation has been started.)' : ''}</span></label>
      <label className="flex items-start gap-2 text-sm text-gray-800"><input type="checkbox" className="mt-1" checked={settings.commentRequiredForAll} disabled={!editable || locked} data-testid="set-comment-all" onChange={(e) => onChange({ commentRequiredForAll: e.target.checked })} />
        <span>A comment is required on every criterion.</span></label>
      <div data-testid="set-divergence">
        <label className="flex items-start gap-2 text-sm text-gray-800"><input type="checkbox" className="mt-1" checked={settings.divergence.enabled} disabled={!editable} onChange={(e) => onChange({ divergence: { ...settings.divergence, enabled: e.target.checked } })} />
          <span><b>Flag divergent evaluations.</b> The application is flagged when two evaluators score very differently. It never changes a score or decides anything.</span></label>
        {settings.divergence.enabled && (
          <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <div><label className={LABEL} htmlFor="set-dscale">On one criterion (% of the scale)</label><input id="set-dscale" inputMode="numeric" autoComplete="off" className={INPUT} disabled={!editable} value={settings.divergence.scalePct} onChange={(e) => onChange({ divergence: { ...settings.divergence, scalePct: Math.min(100, Math.max(1, Number(e.target.value.replace(/\D/g, '').slice(0, 3)) || 1)) } })} /></div>
            <div><label className={LABEL} htmlFor="set-dtotal">In total (%)</label><input id="set-dtotal" inputMode="numeric" autoComplete="off" className={INPUT} disabled={!editable} value={settings.divergence.totalPct} onChange={(e) => onChange({ divergence: { ...settings.divergence, totalPct: Math.min(100, Math.max(1, Number(e.target.value.replace(/\D/g, '').slice(0, 3)) || 1)) } })} /></div>
            <p className="col-span-2 text-[11px] text-gray-500">By default 40 % of the scale (2 points on a 1–5 scale, 4 on a 1–10) on one criterion, or 20 % in total.</p>
          </div>
        )}
      </div>
      <div data-testid="set-deadlines">
        <span className={LABEL}>Deadline of the evaluation, by phase</span>
        {view.phases.length === 0 ? <p className="mt-1 text-xs text-gray-500">Add phases to the call to set a deadline for each.</p> : (
          <ul className="mt-1 space-y-1.5">{view.phases.map((p) => {
            const cur = settings.deadlines.find((x) => x.phaseId === p.id)?.day ?? '';
            return (
              <li key={p.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
                <span className="min-w-0 text-sm text-gray-800 [overflow-wrap:anywhere]">{p.name || 'Phase'}</span>
                <input type="date" aria-label={`Deadline for ${p.name}`} className={INPUT} disabled={!editable} value={cur} onChange={(e) => onChange({ deadlines: [...settings.deadlines.filter((x) => x.phaseId !== p.id), ...(e.target.value ? [{ phaseId: p.id, day: e.target.value }] : [])] })} />
              </li>
            );
          })}</ul>
        )}
      </div>
    </section>
  );
}

export { gradeText, weightedGrade };
