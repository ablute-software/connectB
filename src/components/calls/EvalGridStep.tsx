'use client';
// Prompt 922 (I1) — Setup → "Evaluation grid". Sections (optional) and criteria, each with a name, guidance for the evaluator, a WEIGHT, a SCALE the entity chooses (shortcuts 1–5, 1–10, 0–10, or custom; a different
// scale per criterion if wanted), a description per level or range, "comment required", and an optional eliminatory minimum that only FLAGS. The sum of the weights is live and the step stays ⚠ until it is 100 %.
// A grid can be read from a document (PDF, Word, Excel) by the platform's own reader — "Read on our platform only. Evaluation grids are never sent to an AI provider." — each criterion showing where it came from;
// it can be saved as a template of the organisation and started from one (a copy); the settings (how many evaluators per application, blind evaluation, divergence, deadlines) are here too. Nothing is a browser
// dialog: confirmations are in the page.
// Prompt 922, Adenda 2 (02/11/2026) — simpler: "How the evaluation runs" at the top, folded (one line of summary); a bar with the weights, the coverage of the form and the buttons; the criteria as FOLDED cards (one
// open at a time) whose card shows the essentials and keeps the rest in "More options"; the questions are linked from ONE panel ("Link questions"), the same panel makes "Create from questions" and shows the
// coverage of the form. No second permanent list of questions.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  SCALE_PRESETS, gradeText, levelsToText, presetKeyOf, sameScale, scaleLabel, scaleLevels, textToLevels, weightedGrade, weightsLine, MAX_SCALE_LEVELS, type Criterion, type GridSettings,
} from '@/lib/calls/eval-grid';
import { GRID_NOTICE_TEXT } from '@/lib/calls/eval-grid-text';
import type { GridView } from '@/lib/calls/eval-grid-view';
import type { GridProposal } from '@/lib/calls/eval-grid-reader';
import { callsApi } from './api';
import { AutoTextarea } from './AutoTextarea';
import { AutoEditor, LinkedChips, QuestionPicker } from './EvalGridLinks';
import { autoProblems } from '@/lib/calls/eval-auto';
import { chipText, type LinkableField } from '@/lib/calls/eval-links';
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
const fresh = (scale = { min: 1, max: 5 }): Draft => ({ id: newId(), section: null, position: 0, name: '', guidance: '', weight: '', format: 'scale', scaleMin: scale.min, scaleMax: scale.max, levels: [], commentRequired: false, minScore: '', levelsText: '', linkedFields: [], auto: null, linkNotice: false });
const toDraft = (c: Criterion, source?: Draft['source']): Draft => ({ ...c, weight: String(c.weight), minScore: c.minScore === null ? '' : String(c.minScore), levelsText: levelsToText(c.levels), ...(source ? { source } : {}) });
const toPayload = (d: Draft) => ({ id: d.id, section: d.section, name: d.name, guidance: d.guidance, weight: d.weight === '' ? NaN : Number(d.weight), format: 'scale', scaleMin: d.scaleMin, scaleMax: d.scaleMax, levels: textToLevels(d.levelsText), commentRequired: d.commentRequired, minScore: d.minScore === '' ? null : Number(d.minScore), linkedFields: d.linkedFields ?? [], auto: d.auto ?? null, linkNotice: d.linkNotice === true });
/** A new scale can leave points of a table outside it: those answers go back to "no points yet" (the step says so), never to a value the server would refuse. */
const clampAuto = (d: Draft, patch: Partial<Draft>): Partial<Draft> => {
  if (!d.auto || (patch.scaleMin === undefined && patch.scaleMax === undefined)) return patch;
  const lo = patch.scaleMin ?? d.scaleMin; const hi = patch.scaleMax ?? d.scaleMax; const a = d.auto;
  const ok = (v: number | null) => (v === null || (v >= lo && v <= hi) ? v : null);
  return { ...patch, auto: { ...a, options: Object.fromEntries(Object.entries(a.options).map(([k, v]) => [k, ok(v)])), yes: ok(a.yes), no: ok(a.no), ranges: a.ranges.map((r) => ({ ...r, points: ok(r.points) })) } };
};
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
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<{ kind: 'link'; id: string } | { kind: 'create' } | { kind: 'coverage' } | null>(null);
  const [createSel, setCreateSel] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const runRef = useRef<string | null>(null);

  // The editor hands over a NEW callback on every render. If loading depended on its identity, every render of the editor (and loading itself makes one) would load again and replace what is being typed with
  // what the server has — which is how "Add a criterion" opened and vanished (Prompt 922, Adenda 1, A: the grid was read 126 times in a second and a half). The callback is read through a ref; the grid is read
  // when the call changes, and after a save.
  const countRef = useRef(onCriteriaChanged);
  countRef.current = onCriteriaChanged;
  const apply = useCallback((v: GridView) => {
    setView(v); setDrafts(v.criteria.map((c) => toDraft(c))); setSettings(v.settings); setDirty(false); setOpenIds(new Set()); countRef.current(v.criteria.length);
  }, []);
  const load = useCallback(async () => {
    const [g, t] = await Promise.all([callsApi.evalGrid(callId), callsApi.evalTemplates(callId)]);
    if (!g.ok) { setError(g.body.error ?? 'Could not load the grid.'); return; }
    setError(''); apply(g.body); if (t.ok) setTemplates(t.body.templates);
  }, [callId, apply]);
  useEffect(() => { void load(); }, [load]);

  const editable = !!view && canManage && (view.mode === 'edit' || view.mode === 'versioned');
  const criteria = useMemo(() => drafts.map(asCriterion), [drafts]);
  const weights = weightsLine(criteria);
  const fields = view?.fields ?? [];
  const linkedCount = useMemo(() => { const ids = new Set(drafts.flatMap((d) => d.linkedFields ?? [])); return fields.filter((f) => ids.has(f.id)).length; }, [drafts, fields]);
  const update = (id: string, patch: Partial<Draft>) => { setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...clampAuto(d, patch) } : d))); setDirty(true); };
  const setSet = (patch: Partial<GridSettings>) => { setSettings((s) => (s ? { ...s, ...patch } : s)); setDirty(true); };
  /** Only one card is open at a time: opening one closes the one that was open ("Expand all" is the explicit way to open them all). */
  const toggleCard = (id: string) => setOpenIds((s) => (s.has(id) ? new Set() : new Set([id])));

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
    setAsk(null); runRef.current = null; setImporting(null); setSuggestions({}); apply(r.body);
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError('');
    const r = await callsApi.importEvalGrid(callId, file);
    setBusy(false);
    if (!r.ok) { setError(r.body.error ?? 'The file could not be read.'); return; }
    runRef.current = r.body.runId; setSuggestions(r.body.suggestions ?? {});
    const byName = new Map(r.body.proposal.criteria.map((p) => [p.name, p.source]));
    setImporting({ runId: r.body.runId, fileName: r.body.fileName, notes: r.body.proposal.notes, proposal: r.body.proposal });
    setDrafts((r.body.criteria as Criterion[]).map((c) => toDraft({ ...c, id: newId() }, byName.get(c.name)))); setDirty(true); setOpenIds(new Set());
  }

  async function applyTemplate(id: string) {
    const r = await callsApi.copyEvalTemplate(callId, id);
    if (!r.ok) { setError(r.body.error ?? 'Could not use that template.'); return; }
    setDrafts(r.body.criteria.map((c) => toDraft(c))); setDirty(true); setImporting(null); runRef.current = null; setOpenIds(new Set());
  }
  async function saveTemplate() {
    if (saveName === null) return;
    const r = await callsApi.saveEvalTemplate(callId, saveName);
    if (!r.ok) { setError(r.body.error ?? 'Could not save the template.'); return; }
    setSaveName(null); setTemplates(r.body.templates);
  }

  const addCriterion = () => {
    const last = drafts[drafts.length - 1];
    const d = fresh(last ? { min: last.scaleMin, max: last.scaleMax } : undefined);
    setDrafts((ds) => [...ds, d]); setOpenIds(new Set([d.id])); setDirty(true);
  };
  const duplicate = (i: number) => {
    const src = drafts[i]; const copy: Draft = { ...src, id: newId(), name: src.name ? `${src.name} (copy)` : '', source: undefined };
    setDrafts((ds) => [...ds.slice(0, i + 1), copy, ...ds.slice(i + 1)]); setOpenIds(new Set([copy.id])); setDirty(true);
  };
  /** One criterion per chosen question, already linked to it, with equal weights that add up to what is left of the 100 % (the rounding goes to the first). */
  const createFromQuestions = () => {
    const picked = fields.filter((f) => createSel.includes(f.id));
    if (picked.length === 0) return;
    const existing = drafts.reduce((n, d) => n + (Number(d.weight) || 0), 0);
    const room = drafts.length > 0 && existing > 0 && existing < 100 ? Math.round((100 - existing) * 100) / 100 : 100;
    const each = Math.floor((room / picked.length) * 100) / 100;
    const first = Math.round((room - each * (picked.length - 1)) * 100) / 100;
    const last = drafts[drafts.length - 1];
    const made = picked.map((f, k): Draft => ({ ...fresh(last ? { min: last.scaleMin, max: last.scaleMax } : undefined), name: chipText(f, 60), weight: String(k === 0 ? first : each), linkedFields: [f.id] }));
    setDrafts((ds) => [...ds, ...made]); setOpenIds(new Set()); setDirty(true); setCreateSel([]); setPicker(null);
  };

  if (!view || !settings) return <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500" data-testid="grid-loading">{error || 'Loading the grid…'}</div>;

  const same = sameScale(criteria);
  const summary = [
    criteria.length === 0 ? 'No criteria yet' : same ? `Scale ${same.min}–${same.max}` : 'Several scales',
    settings.evaluatorsPerApplication === 'all' ? 'every evaluator per application' : `${settings.evaluatorsPerApplication} evaluator${settings.evaluatorsPerApplication === 1 ? '' : 's'} per application`,
    `Blind: ${settings.blind ? 'on' : 'off'}`,
    `Divergence alert: ${settings.divergence.enabled ? `${settings.divergence.scalePct} %` : 'off'}`,
  ].join(' · ');
  const picking = picker?.kind === 'link' ? drafts.find((d) => d.id === picker.id) : undefined;

  return (
    <div className="min-w-0 space-y-4" data-testid="eval-grid-step">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Evaluation grid</h3>
        <p className="mt-1 text-xs text-gray-600">The criteria the evaluators score, each with a weight and its own scale. The grid never excludes anyone by itself.</p>
        {view.mode === 'locked' && <p className="mt-2 rounded bg-sky-50 px-2 py-1.5 text-xs text-sky-900" data-testid="grid-locked">The grid is locked while the call is confirmed. Use “Edit configuration” in Review &amp; publish to change it before the call opens.</p>}
        {view.mode === 'versioned' && <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900" data-testid="grid-frozen">{view.evaluations.submitted} evaluation{view.evaluations.submitted === 1 ? '' : 's'} already submitted: the grid is frozen (version {view.version}). Changing the criteria makes a new version; those evaluations keep theirs.</p>}
        {view.mode === 'archived' && <p className="mt-2 rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-700">An archived call cannot be changed.</p>}
        <ScrollTabs label="Grid view" className="mt-3 flex gap-1 border-b border-gray-200">
          {(['build', 'preview'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} data-testid={`grid-tab-${t}`} onClick={() => setTab(t)}
            className={`-mb-px min-h-[44px] border-b-2 px-3 py-2 text-sm sm:min-h-0 ${tab === t ? 'border-[#0E7490] font-semibold text-[#0E7490]' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>{t === 'build' ? 'Build' : 'As the evaluator sees it'}</button>)}
        </ScrollTabs>
      </section>

      {tab === 'preview' ? (
        <EvaluatorPreview criteria={criteria} fields={fields} />
      ) : (
        <>
          <section className="rounded-lg border border-gray-200 bg-white" data-testid="grid-run">
            <button type="button" aria-expanded={settingsOpen} className="flex min-h-[44px] w-full min-w-0 items-center justify-between gap-3 px-4 py-2.5 text-left" data-testid="grid-settings-toggle" onClick={() => setSettingsOpen((o) => !o)}>
              <span className="min-w-0"><span className="block text-sm font-semibold text-gray-900">How the evaluation runs</span><span className="block text-xs text-gray-600 [overflow-wrap:anywhere]" data-testid="grid-settings-summary">{summary}</span></span>
              <span aria-hidden="true" className="shrink-0 text-gray-500">{settingsOpen ? '▾' : '▸'}</span>
            </button>
            {settingsOpen && <div className="border-t border-gray-100"><SettingsPanel settings={settings} view={view} editable={editable} onChange={setSet} /></div>}
          </section>

          <section className="min-w-0 space-y-2 rounded-lg border border-gray-200 bg-white p-3" data-testid="grid-bar">
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
              <p className={`text-sm font-semibold ${weights.ok ? 'text-emerald-900' : 'text-amber-950'}`} aria-live="polite" data-testid="grid-weights">{drafts.length === 0 ? 'Weights: —' : `${weights.ok ? '' : '⚠ '}Weights: ${weights.sum} / 100 %${weights.ok ? ' ✓' : ''}`}</p>
              <button type="button" className="text-sm font-medium text-[#0E7490] hover:underline" data-testid="form-coverage" onClick={() => setPicker({ kind: 'coverage' })}>Form coverage ({linkedCount} / {fields.length})</button>
              <span className="text-xs text-gray-500" data-testid="grid-coverage">{linkedCount} of {fields.length} question{fields.length === 1 ? '' : 's'} linked</span>
            </div>
            {!weights.ok && drafts.length > 0 && <p className="text-xs text-amber-900">Saved as you go; the call cannot be confirmed until the weights add up to 100 %.</p>}
            {editable && (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <button type="button" className={PRIMARY} data-testid="add-criterion" onClick={addCriterion} disabled={busy}>+ Add criterion</button>
                <button type="button" className={BTN} data-testid="create-from-questions" disabled={busy || fields.length === 0} onClick={() => { setCreateSel([]); setPicker({ kind: 'create' }); }}>Create from questions</button>
                <label className={`${BTN} cursor-pointer`}>Import from a document<input type="file" accept=".pdf,.docx,.xlsx" className="sr-only" data-testid="grid-import-file" disabled={busy} onChange={(e) => { void chooseFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
                {templates.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-700">Templates
                    <select className={`${INPUT} !w-auto`} data-testid="grid-template-select" defaultValue="" onChange={(e) => { if (e.target.value) { void applyTemplate(e.target.value); e.target.value = ''; } }}>
                      <option value="">Start from…</option>{templates.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.criteria})</option>)}
                    </select></label>
                )}
                {!dirty && drafts.length > 0 && saveName === null && <button type="button" className={BTN} data-testid="grid-save-template" onClick={() => setSaveName('')}>Save as template</button>}
              </div>
            )}
            <p className="text-[11px] text-gray-500" data-testid="grid-privacy">{GRID_NOTICE_TEXT}</p>
            {importing && (
              <div className="rounded-lg bg-[#E8F4F8] p-2.5" data-testid="grid-import-review">
                <p className="text-sm font-medium text-gray-900">Read from “{importing.fileName}”: check each criterion and correct what is wrong.</p>
                {importing.notes.map((n) => <p key={n} className="mt-1 text-xs text-amber-900" data-testid="grid-import-note">{n}</p>)}
              </div>
            )}
          </section>

          <section className="space-y-2" aria-label="Criteria">
            {drafts.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500" data-testid="no-criteria">No criteria yet. Add the first one, create them from the questions, or import a grid from a document.</p>}
            {drafts.length > 1 && (
              <div className="flex items-center justify-end gap-3 text-xs">
                <button type="button" className="font-medium text-[#0E7490] hover:underline" data-testid="expand-all" onClick={() => setOpenIds(new Set(drafts.map((d) => d.id)))}>Expand all</button>
                <button type="button" className="font-medium text-[#0E7490] hover:underline" data-testid="collapse-all" onClick={() => setOpenIds(new Set())}>Collapse all</button>
              </div>
            )}
            {drafts.map((d, i) => (
              <CriterionCard key={d.id} d={d} index={i} total={drafts.length} editable={editable} open={openIds.has(d.id)} removing={removing === d.id} fields={fields} suggestion={suggestions[d.name]}
                onToggle={() => toggleCard(d.id)} onChange={(p) => update(d.id, p)} onOpenPicker={() => setPicker({ kind: 'link', id: d.id })} onDuplicate={() => duplicate(i)}
                onMove={(dir) => { setDrafts((ds) => { const n = [...ds]; const j = i + dir; if (j < 0 || j >= n.length) return ds; [n[i], n[j]] = [n[j], n[i]]; return n; }); setDirty(true); }}
                onAskRemove={() => setRemoving(d.id)} onKeep={() => setRemoving(null)} onRemove={() => { setDrafts((ds) => ds.filter((x) => x.id !== d.id)); setRemoving(null); setDirty(true); }} />
            ))}
          </section>

          {ask && (
            <div className="rounded-lg border border-[#0E7490] bg-white p-3" role="group" aria-label="Confirm the change" data-testid="grid-confirm">
              <p className="text-sm text-gray-800">{ask}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={busy} className={PRIMARY} data-testid="grid-confirm-yes" onClick={() => void save(true)}>{busy ? 'Saving…' : 'Yes, make the new version'}</button>
                <button type="button" disabled={busy} className={BTN} data-testid="grid-confirm-no" onClick={() => setAsk(null)}>Cancel</button>
              </div>
            </div>
          )}

          {/* An error is shown right where the person is looking — above the buttons that caused it — never at the top of a long step. */}
          {error && <p role="alert" className="rounded bg-red-50 px-2 py-1.5 text-xs text-[#B00000]" data-testid="grid-error-near">{error}</p>}
          {editable && (
            <div className="flex flex-wrap items-center gap-2" data-testid="grid-actions">
              <button type="button" className={PRIMARY} disabled={busy || !dirty} data-testid="grid-save" onClick={() => void save(false)}>{busy ? 'Saving…' : 'Save the grid'}</button>
              {dirty && <span className="text-xs text-amber-900" data-testid="grid-dirty">Not saved yet</span>}
            </div>
          )}
          {saveName !== null && (
            <div className="rounded-lg border border-gray-300 bg-white p-3" role="group" aria-label="Save as template" data-testid="grid-template-form">
              <label className={LABEL} htmlFor="tpl-name">Template name</label>
              <input id="tpl-name" autoComplete="off" className={INPUT} value={saveName} maxLength={120} onChange={(e) => setSaveName(e.target.value)} data-testid="grid-template-name" />
              <p className="mt-1 text-[11px] text-gray-500">A template is a copy for the whole organisation to start from: nothing is shared afterwards.</p>
              <div className="mt-2 flex gap-2"><button type="button" className={PRIMARY} data-testid="grid-template-save" onClick={() => void saveTemplate()}>Save the template</button><button type="button" className={BTN} onClick={() => setSaveName(null)}>Cancel</button></div>
            </div>
          )}
        </>
      )}

      {picker?.kind === 'link' && picking && (
        <QuestionPicker mode="link" fields={fields} criteria={criteria} currentId={picking.id} selected={picking.linkedFields ?? []} locked={picking.auto?.fieldId} onClose={() => setPicker(null)} onDone={() => setPicker(null)}
          onToggle={(id) => { const cur = picking.linkedFields ?? []; update(picking.id, { linkedFields: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id], linkNotice: false }); }} />
      )}
      {picker?.kind === 'create' && (
        <QuestionPicker mode="create" fields={fields} criteria={criteria} selected={createSel} onClose={() => setPicker(null)} onDone={createFromQuestions} onToggle={(id) => setCreateSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
      )}
      {picker?.kind === 'coverage' && <QuestionPicker mode="coverage" fields={fields} criteria={criteria} selected={[]} onClose={() => setPicker(null)} onDone={() => setPicker(null)} onToggle={() => undefined} />}
    </div>
  );
}

/** A short help line is always visible; the long explanation hides behind a "?" next to the label. */
function Help({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline">
      <button type="button" aria-label={`More about ${label}`} aria-expanded={open} className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-[11px] font-semibold text-gray-500 hover:text-[#0E7490]" data-testid="help-toggle" onClick={() => setOpen((o) => !o)}>?</button>
      {open && <span role="note" className="mt-1 block rounded bg-gray-50 px-2 py-1.5 text-[11px] font-normal normal-case tracking-normal text-gray-600" data-testid="help-text">{children}</span>}
    </span>
  );
}

function CriterionCard({ d, index, total, editable, open, removing, fields, suggestion, onToggle, onChange, onOpenPicker, onDuplicate, onMove, onAskRemove, onKeep, onRemove }: {
  d: Draft; index: number; total: number; editable: boolean; open: boolean; removing: boolean; fields: LinkableField[]; suggestion?: string[]; onToggle: () => void; onChange: (p: Partial<Draft>) => void; onOpenPicker: () => void;
  onDuplicate: () => void; onMove: (dir: -1 | 1) => void; onAskRemove: () => void; onKeep: () => void; onRemove: () => void;
}) {
  const preset = presetKeyOf(d);
  const levels = scaleLevels(d);
  const [more, setMore] = useState(false);
  const [menu, setMenu] = useState(false);
  const linked = d.linkedFields ?? [];
  const warnings: string[] = [];
  if (!d.name.trim()) warnings.push('needs a name');
  if (d.weight === '') warnings.push('needs a weight');
  if (linked.some((id) => !fields.some((f) => f.id === id))) warnings.push('a linked question was removed');
  if (d.auto) { const f = fields.find((x) => x.id === d.auto!.fieldId); if (autoProblems(d.auto, f && { kind: f.kind, label: f.label, options: f.options }, d.name || 'This criterion').length > 0) warnings.push('points to complete'); }
  if (d.linkNotice && linked.length === 0) warnings.push('link it to the questions');
  return (
    <article className="min-w-0 rounded-lg border border-gray-200 bg-white" data-testid="criterion-card" data-open={open ? 'true' : 'false'}>
      <div className="flex min-w-0 items-center gap-1 px-2 py-1">
        <button type="button" aria-expanded={open} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded px-1 text-left hover:bg-gray-50 sm:min-h-0 sm:py-1.5" data-testid="criterion-toggle" onClick={onToggle}>
          <span aria-hidden="true" className="shrink-0 text-gray-400">{open ? '▾' : '▸'}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-gray-900" data-testid="criterion-title">{d.name.trim() || `Criterion ${index + 1}`}</span>
            <span className="block text-xs text-gray-600 [overflow-wrap:anywhere]" data-testid="criterion-summary">
              {d.weight === '' ? 'no weight' : `${d.weight} %`} · scale {scaleLabel(d)} · {linked.length === 0 ? 'no questions linked' : `${linked.length} question${linked.length === 1 ? '' : 's'}`}
              {d.auto ? ' · automatic' : ''}{warnings.length > 0 && <span className="ml-1 font-medium text-amber-900" data-testid="criterion-warning">⚠ {warnings[0]}</span>}
            </span>
          </span>
        </button>
        {editable && (
          <span className="relative flex shrink-0 items-center">
            <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)} className="rounded px-2 py-1 text-gray-500 hover:text-[#0E7490] disabled:opacity-30">↑</button>
            <button type="button" aria-label="Move down" disabled={index === total - 1} onClick={() => onMove(1)} className="rounded px-2 py-1 text-gray-500 hover:text-[#0E7490] disabled:opacity-30">↓</button>
            <button type="button" aria-label="More actions" aria-expanded={menu} data-testid="criterion-menu" onClick={() => setMenu((m) => !m)} className="rounded px-2 py-1 text-gray-500 hover:text-[#0E7490]">⋯</button>
            {menu && (
              <span className="absolute right-0 top-full z-10 mt-1 flex w-40 flex-col rounded-lg border border-gray-200 bg-white p-1 shadow-lg" role="menu">
                <button type="button" role="menuitem" className="min-h-[44px] rounded px-2 text-left text-sm text-gray-800 hover:bg-gray-50 sm:min-h-0 sm:py-1.5" data-testid="criterion-duplicate" onClick={() => { setMenu(false); onDuplicate(); }}>Duplicate</button>
                <button type="button" role="menuitem" className="min-h-[44px] rounded px-2 text-left text-sm text-[#B00000] hover:bg-red-50 sm:min-h-0 sm:py-1.5" data-testid="criterion-remove" onClick={() => { setMenu(false); onAskRemove(); }}>Remove…</button>
              </span>
            )}
          </span>
        )}
      </div>
      {removing && (
        <div className="mx-3 mb-2 rounded border border-[#B00000] p-2" role="group" aria-label="Confirm removing the criterion" data-testid="criterion-remove-confirm">
          <p className="text-xs text-gray-800">Remove “{d.name || 'this criterion'}”?</p>
          <div className="mt-1.5 flex gap-2"><button type="button" className="min-h-[44px] rounded-lg bg-[#B00000] px-3 py-1 text-sm font-semibold text-white sm:min-h-0 sm:text-xs" data-testid="criterion-remove-yes" onClick={onRemove}>Yes, remove it</button><button type="button" className={BTN} data-testid="criterion-remove-no" onClick={onKeep}>Keep</button></div>
        </div>
      )}
      {open && (
        <div className="space-y-3 border-t border-gray-100 px-3 pb-3 pt-3" data-testid="criterion-body">
          {d.source && <p className="text-[11px] text-gray-500 [overflow-wrap:anywhere]" data-testid="criterion-source">Read from line {d.source.line}: “{d.source.text}”</p>}
          <div><label className={LABEL} htmlFor={`cn-${d.id}`}>Name</label>
            <AutoTextarea id={`cn-${d.id}`} className={INPUT} value={d.name} disabled={!editable} maxLength={160} placeholder="e.g. Team" onChange={(name) => onChange({ name })} /></div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <div><label className={LABEL} htmlFor={`cw-${d.id}`}>Weight (%)</label>
              <input id={`cw-${d.id}`} inputMode="decimal" autoComplete="off" className={INPUT} disabled={!editable} value={d.weight} placeholder="e.g. 25" data-testid="criterion-weight" onChange={(e) => onChange({ weight: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.').slice(0, 7) })} /></div>
            <div><label className={LABEL} htmlFor={`cp-${d.id}`}>Scale</label>
              <select id={`cp-${d.id}`} className={INPUT} disabled={!editable} value={preset} data-testid="criterion-scale"
                onChange={(e) => { const p = SCALE_PRESETS.find((x) => x.key === e.target.value); if (p) onChange({ scaleMin: p.min, scaleMax: p.max, minScore: '', levelsText: '' }); else onChange({ scaleMin: d.scaleMin, scaleMax: d.scaleMax === d.scaleMin + 4 && preset !== 'custom' ? d.scaleMax + 1 : d.scaleMax }); }}>
                {SCALE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}<option value="custom">Custom…</option>
              </select></div>
            {preset === 'custom' && (
              <>
                <div><label className={LABEL} htmlFor={`cmin-${d.id}`}>Minimum</label><input id={`cmin-${d.id}`} inputMode="numeric" autoComplete="off" className={INPUT} disabled={!editable} value={d.scaleMin} data-testid="criterion-min" onChange={(e) => onChange({ scaleMin: Number(e.target.value.replace(/\D/g, '').slice(0, 3)) || 0 })} /></div>
                <div><label className={LABEL} htmlFor={`cmax-${d.id}`}>Maximum</label><input id={`cmax-${d.id}`} inputMode="numeric" autoComplete="off" className={INPUT} disabled={!editable} value={d.scaleMax} data-testid="criterion-max" onChange={(e) => onChange({ scaleMax: Number(e.target.value.replace(/\D/g, '').slice(0, 3)) || 0 })} /></div>
                {d.scaleMax - d.scaleMin + 1 > MAX_SCALE_LEVELS && <p className="col-span-2 text-xs text-[#B00000]">At most {MAX_SCALE_LEVELS} levels.</p>}
              </>
            )}
          </div>
          <LinkedChips d={d} fields={fields} editable={editable} suggestion={suggestion} locked={d.auto?.fieldId} onChange={(linkedFields) => onChange({ linkedFields, linkNotice: false })} onOpen={onOpenPicker} />
          <div className="rounded bg-gray-50">
            <button type="button" aria-expanded={more} className="flex min-h-[44px] w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs font-medium text-[#0E7490] sm:min-h-0" data-testid="criterion-more" onClick={() => setMore((m) => !m)}>
              <span>More options{d.guidance.trim() || d.levelsText.trim() || d.section || d.commentRequired || d.minScore !== '' || d.auto ? ' ✓' : ''}</span><span aria-hidden="true">{more ? '▾' : '▸'}</span>
            </button>
            {more && (
              <div className="space-y-3 border-t border-gray-100 px-2.5 py-2.5" data-testid="criterion-more-body">
                <div><label className={LABEL} htmlFor={`cg-${d.id}`}>Guidance for the evaluator</label>
                  <AutoTextarea id={`cg-${d.id}`} multiline className={INPUT} value={d.guidance} disabled={!editable} maxLength={1500} onChange={(guidance) => onChange({ guidance })} /></div>
                <div><label className={LABEL} htmlFor={`cl-${d.id}`}>Describe the levels (optional)<Help label="describing the levels">One line each: “{d.scaleMax}: excellent”{levels.length > 5 ? ` or a range “${d.scaleMin}–${d.scaleMin + 2}: weak”` : ''}. The evaluator sees the description of the level they choose.</Help></label>
                  <AutoTextarea id={`cl-${d.id}`} multiline ariaLabel="Descriptions of the levels" className={INPUT} value={d.levelsText} disabled={!editable} onChange={(levelsText) => onChange({ levelsText })} /></div>
                <div><label className={LABEL} htmlFor={`cs-${d.id}`}>Section (optional)</label>
                  <input id={`cs-${d.id}`} autoComplete="off" className={INPUT} disabled={!editable} value={d.section ?? ''} maxLength={80} onChange={(e) => onChange({ section: e.target.value || null })} /></div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={d.commentRequired} disabled={!editable} data-testid="criterion-comment-required" onChange={(e) => onChange({ commentRequired: e.target.checked })} /> Comment required</label>
                  <label className="flex items-center gap-2 text-xs text-gray-700">Eliminatory minimum
                    <select aria-label="Eliminatory minimum" className={`${INPUT} !w-auto`} disabled={!editable} value={d.minScore} data-testid="criterion-minscore" onChange={(e) => onChange({ minScore: e.target.value })}>
                      <option value="">none</option>{levels.slice(1).map((l) => <option key={l} value={l}>{l}</option>)}
                    </select><Help label="the eliminatory minimum">A score below it flags the application for the administrator. It is never excluded automatically.</Help></label>
                </div>
                <AutoEditor d={d} fields={fields} editable={editable} onChange={(auto, link) => onChange({ auto, ...(link ? { linkedFields: link } : {}), linkNotice: false })} />
              </div>
            )}
          </div>
        </div>
      )}
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
