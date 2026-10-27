'use client';
// Prompt 917 (I1) — the entity's side of the new kinds of question: what a File accepts (formats, how many files, size), the hint of a Link, and the whole
// configuration of a repeatable group (what an entry is called, how many there can be, its questions, cards or table, and the rows of a table when the
// entity sets them). Every change goes up as a new validations object; the server checks it all again (parseFieldsPayload).
import { FILE_FORMAT_KEYS, MAX_FILE_MB_CEILING, MAX_FILES_CEILING, MAX_GROUP_ENTRIES, MAX_GROUP_SUBFIELDS, SIMPLE_KINDS, URL_HINTS, URL_HINT_LABELS, FIELD_KIND_LABELS, isChoiceKind, DEFAULT_MAX_FILE_MB,
  type FieldValidations, type FormField, type GroupConfig, type SimpleKind, type SubField } from '@/lib/calls/types';
import { FILE_FORMATS, fileFormatsOf, maxFilesOf, newOptionIdLocal, newSubField } from '@/lib/calls/field-config';
import { AutoTextarea } from './AutoTextarea';
import { useState } from 'react';
import { convertGroupToTable } from '@/lib/calls/table';

// `w-full` AND `min-w-0`: a field fills the panel and may shrink below its natural width. (It used to be combined with `w-40` on a select — Tailwind emits `w-full` last, so it won, and the
// select took the whole row and squeezed the question's text box to a 20 px square; Prompt 917 Adenda 2 A.)
const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-500';

type Validations = Omit<FieldValidations, 'group'>;

/** What a File question accepts: the formats (PDF by default), how many files, the size of each. Never a ZIP. */
export function FileConfigEditor({ value, disabled, idPrefix, onChange }: { value: Validations; disabled?: boolean; idPrefix: string; onChange: (v: Validations) => void }) {
  const chosen = fileFormatsOf(value);
  const maxFiles = maxFilesOf(value);
  const toggle = (k: (typeof FILE_FORMAT_KEYS)[number]) => {
    const next = chosen.includes(k) ? chosen.filter((x) => x !== k) : [...chosen, k];
    if (next.length === 0) return;                                 // at least one format
    onChange({ ...value, fileFormats: next.length === 1 && next[0] === 'pdf' ? undefined : FILE_FORMAT_KEYS.filter((x) => next.includes(x)) });
  };
  return (
    <div className="space-y-2" data-testid="file-config">
      <div>
        <span className={LABEL}>Accepted formats</span>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {FILE_FORMAT_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={chosen.includes(k)} disabled={disabled} onChange={() => toggle(k)} data-testid={`format-${k}`} /> {FILE_FORMATS[k].label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-gray-400">The format is checked on the file itself, not on its name. ZIP files are never accepted: for several files use “Allow several files”.</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <div>
          <label className={LABEL} htmlFor={`${idPrefix}-mb`}>Max size per file (MB)</label>
          <input id={`${idPrefix}-mb`} type="number" min={1} max={MAX_FILE_MB_CEILING} autoComplete="off" className={INPUT} disabled={disabled} value={value.maxFileMb ?? DEFAULT_MAX_FILE_MB}
            onChange={(e) => onChange({ ...value, maxFileMb: e.target.value ? Number(e.target.value) : undefined })} />
        </div>
        <div>
          <label className="mt-5 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={maxFiles > 1} disabled={disabled} data-testid="allow-several"
              onChange={(e) => onChange({ ...value, maxFiles: e.target.checked ? 3 : undefined })} /> Allow several files
          </label>
        </div>
      </div>
      {maxFiles > 1 && (
        <div>
          <label className={LABEL} htmlFor={`${idPrefix}-max`}>Maximum number of files (up to {MAX_FILES_CEILING})</label>
          <input id={`${idPrefix}-max`} type="number" min={2} max={MAX_FILES_CEILING} autoComplete="off" className={INPUT} disabled={disabled} value={maxFiles} data-testid="max-files"
            onChange={(e) => onChange({ ...value, maxFiles: e.target.value ? Math.min(MAX_FILES_CEILING, Math.max(2, Number(e.target.value))) : 2 })} />
        </div>
      )}
    </div>
  );
}

/** The hint of a Link question: what kind of link is expected. A hint for the applicant, never a restriction. */
export function UrlConfigEditor({ value, disabled, onChange }: { value: Validations; disabled?: boolean; onChange: (v: Validations) => void }) {
  return (
    <div>
      <label className={LABEL} htmlFor="fp-urlhint">Expected link (a hint)</label>
      <select id="fp-urlhint" className={INPUT} disabled={disabled} value={value.urlHint ?? ''} onChange={(e) => onChange({ ...value, urlHint: (e.target.value || undefined) as Validations['urlHint'] })}>
        <option value="">Any link</option>
        {URL_HINTS.map((h) => <option key={h} value={h}>{URL_HINT_LABELS[h]}</option>)}
      </select>
      <p className="mt-1 text-[11px] text-gray-400">Only http:// and https:// links are accepted. It only guides the applicant: any link of that shape is accepted. In Submissions the link opens in a new tab; nothing is embedded or previewed.</p>
    </div>
  );
}

const rowsToText = (rows: string[][]): string => rows.map((r) => r.join(' | ')).join('\n');
const textToRows = (t: string): string[][] => t.split('\n').map((l) => l.split('|').map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));

function SubFieldEditor({ sub, index, total, disabled, onChange, onRemove, onMove }: {
  sub: SubField; index: number; total: number; disabled?: boolean; onChange: (s: SubField) => void; onRemove: () => void; onMove: (d: -1 | 1) => void;
}) {
  const setKind = (kind: SimpleKind) => { const base = newSubField(kind); onChange({ ...base, id: sub.id, label: sub.label, required: sub.required }); };
  const optionsText = sub.options.map((o) => o.label).join('\n');
  const setOptions = (t: string) => {
    const labels = t.split('\n').map((l) => l.slice(0, 300));
    onChange({ ...sub, options: labels.map((label, i) => ({ id: sub.options[i]?.id ?? newOptionIdLocal(), label })) });
  };
  return (
    <li className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 p-2.5" data-testid="group-subfield">
      {/* The corner: the number and the three buttons, INSIDE the card. The text of the question has its own full-width line under it. */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Question {index + 1}</span>
        <span className="flex shrink-0 items-center">
          <button type="button" aria-label="Move up" disabled={disabled || index === 0} onClick={() => onMove(-1)} className="rounded px-1.5 text-gray-500 hover:text-[#0E7490] disabled:opacity-30">↑</button>
          <button type="button" aria-label="Move down" disabled={disabled || index === total - 1} onClick={() => onMove(1)} className="rounded px-1.5 text-gray-500 hover:text-[#0E7490] disabled:opacity-30">↓</button>
          <button type="button" aria-label="Remove question" disabled={disabled || total <= 1} onClick={onRemove} className="rounded px-1.5 text-gray-400 hover:text-[#B00000] disabled:opacity-30">✕</button>
        </span>
      </div>
      <AutoTextarea ariaLabel="Question" testId="subfield-label" className={`mt-1 ${INPUT}`} value={sub.label} disabled={disabled} maxLength={300} placeholder="The question" onChange={(label) => onChange({ ...sub, label })} />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <select aria-label="Type" className={`${INPUT} !w-auto max-w-full`} value={sub.kind} disabled={disabled} onChange={(e) => setKind(e.target.value as SimpleKind)}>
          {SIMPLE_KINDS.map((k) => <option key={k} value={k}>{FIELD_KIND_LABELS[k]}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={sub.required} disabled={disabled} onChange={(e) => onChange({ ...sub, required: e.target.checked })} /> Required in every entry</label>
      </div>
      {isChoiceKind(sub.kind) && (
        <div className="mt-1.5">
          <label className={LABEL}>Options (one per line)</label>
          <textarea rows={3} autoComplete="off" className={INPUT} disabled={disabled} value={optionsText} onChange={(e) => setOptions(e.target.value)} />
        </div>
      )}
      {sub.kind === 'file' && <div className="mt-1.5"><FileConfigEditor value={sub.validations} disabled={disabled} idPrefix={`sub-${sub.id}`} onChange={(v) => onChange({ ...sub, validations: v })} /></div>}
      {sub.kind === 'url' && <div className="mt-1.5"><UrlConfigEditor value={sub.validations} disabled={disabled} onChange={(v) => onChange({ ...sub, validations: v })} /></div>}
      {(sub.kind === 'short_text' || sub.kind === 'long_text') && (
        <div className="mt-1.5 w-40">
          <label className={LABEL}>Max characters</label>
          <input type="number" min={1} autoComplete="off" className={INPUT} disabled={disabled} value={sub.validations.maxLength ?? ''} onChange={(e) => onChange({ ...sub, validations: { ...sub.validations, maxLength: e.target.value ? Number(e.target.value) : undefined } })} />
        </div>
      )}
    </li>
  );
}

/** What "Convert to Table" needs from the screen around it: the question, whether the person may do it (it works even where the form is otherwise locked), and the call to the server. */
export interface ConvertAction {
  field: Pick<FormField, 'kind' | 'validations' | 'required'>;
  allowed: boolean;
  run: (confirm: boolean) => Promise<{ ok: true; message: string } | { ok: false; code?: string; error: string }>;
}

/** "Convert to Table" (Prompt 917, Adenda 2, B4): shown on a group in table mode with rows the entity set — the shape the import used to make of a comparison table, the wrong way round. */
function ConvertToTable({ action }: { action: ConvertAction }) {
  const plan = convertGroupToTable(action.field);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  // The questions are asked IN the page, not with the browser's own dialog: one the browser was told to suppress answers "no" without a word, and the button then seems to do nothing.
  const [asking, setAsking] = useState<{ text: string; confirmed: boolean } | null>(null);
  async function run(confirmed: boolean) {
    setAsking(null); setBusy(true); setProblem(''); setMessage('');
    const r = await action.run(confirmed);
    setBusy(false);
    if (!r.ok && r.code === 'needs_confirm') { setAsking({ text: r.error, confirmed: true }); return; }
    if (r.ok) setMessage(r.message); else setProblem(r.error);
  }
  return (
    <div className="min-w-0 rounded-lg border border-[#BAD9E3] bg-[#E8F4F8] p-2.5" data-testid="convert-to-table">
      <p className="text-xs font-semibold text-[#0E7490]">This is a comparison table</p>
      <p className="mt-0.5 text-xs text-gray-700">A <b>Table</b> suits it better: the criteria down the first column, the companies along the first row, and applicants can add columns (more competitors).{plan.ok ? ` ${plan.summary}` : ''}</p>
      {!plan.ok && <p className="mt-1 text-xs text-gray-600" data-testid="convert-reason">{plan.reason}</p>}
      <button type="button" disabled={!plan.ok || !action.allowed || busy} onClick={() => plan.ok && setAsking({ text: `Convert this group into a Table? ${plan.summary} Unfinished applications are carried over. This cannot be undone.`, confirmed: false })} data-testid="convert-button"
        className="mt-2 min-h-[44px] w-full rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40 sm:w-auto">{busy ? 'Converting…' : 'Convert to Table'}</button>
      {asking && (
        <div className="mt-2 rounded-lg border border-[#0E7490] bg-white p-2.5" role="group" aria-label="Confirm the conversion" data-testid="convert-confirm">
          <p className="text-xs text-gray-800">{asking.text}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void run(asking.confirmed)} data-testid="convert-confirm-yes" className="min-h-[44px] rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">{asking.confirmed ? 'Yes, convert anyway' : 'Yes, convert it'}</button>
            <button type="button" disabled={busy} onClick={() => setAsking(null)} data-testid="convert-confirm-no" className="min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}
      {message && <p role="status" className="mt-1.5 text-xs text-emerald-900" data-testid="convert-done">{message}</p>}
      {problem && <p role="alert" className="mt-1.5 text-xs text-[#B00000]" data-testid="convert-error">{problem}</p>}
    </div>
  );
}

/** The configuration of a repeatable group. */
export function GroupEditor({ value, disabled, onChange, convert }: { value: GroupConfig; disabled?: boolean; onChange: (g: GroupConfig) => void; convert?: ConvertAction }) {
  const set = (patch: Partial<GroupConfig>) => onChange({ ...value, ...patch });
  const preset = value.presetRows.length > 0;
  // Always by the sub-question's own id, never by its place in the list (Prompt 917, 27/10/2026).
  const setSub = (id: string, s: SubField) => set({ subFields: value.subFields.map((x) => (x.id === id ? s : x)) });
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= value.subFields.length) return; const next = [...value.subFields]; [next[i], next[j]] = [next[j], next[i]]; set({ subFields: next }); };
  return (
    <div className="min-w-0 space-y-3" data-testid="group-config">
      {convert && value.display === 'table' && value.presetRows.length > 0 && <ConvertToTable action={convert} />}
      <p className="rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-500">A repeatable group asks the same questions again and again: “Add another”. In version 1 a group cannot contain another group, and display conditions cannot depend on a question inside a group.</p>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-3">
          <label className={LABEL} htmlFor="grp-entry">What is one entry called?</label>
          <input id="grp-entry" autoComplete="off" className={INPUT} disabled={disabled} value={value.entryLabel} maxLength={80} placeholder="Team member" onChange={(e) => set({ entryLabel: e.target.value })} />
        </div>
        <div>
          <label className={LABEL} htmlFor="grp-min">Minimum</label>
          <input id="grp-min" type="number" min={0} max={MAX_GROUP_ENTRIES} autoComplete="off" className={INPUT} disabled={disabled || preset} value={preset ? value.presetRows.length : value.min} data-testid="group-min"
            onChange={(e) => set({ min: Math.max(0, Number(e.target.value) || 0) })} />
        </div>
        <div>
          <label className={LABEL} htmlFor="grp-max">Maximum</label>
          <input id="grp-max" type="number" min={1} max={MAX_GROUP_ENTRIES} autoComplete="off" className={INPUT} disabled={disabled || preset} value={preset ? value.presetRows.length : value.max} data-testid="group-max"
            onChange={(e) => set({ max: Math.max(1, Number(e.target.value) || 1) })} />
        </div>
        <div>
          <label className={LABEL} htmlFor="grp-display">Shown as</label>
          <select id="grp-display" className={INPUT} disabled={disabled} value={value.display} onChange={(e) => set({ display: e.target.value === 'table' ? 'table' : 'cards' })} data-testid="group-display">
            <option value="cards">Cards</option>
            <option value="table">Table</option>
          </select>
        </div>
      </div>
      {value.display === 'table' && (
        <div data-testid="group-rows">
          <span className={LABEL}>Rows</span>
          <label className="mt-1 flex items-center gap-2 text-sm"><input type="radio" name="grp-rows" checked={!preset} disabled={disabled} onChange={() => set({ presetRows: [] })} /> The applicant adds the rows</label>
          <label className="mt-1 flex items-center gap-2 text-sm"><input type="radio" name="grp-rows" checked={preset} disabled={disabled} onChange={() => set({ presetRows: [[value.entryLabel || 'Row 1']] })} data-testid="rows-preset" /> I set the rows</label>
          {preset && (
            <div className="mt-1.5">
              <textarea rows={Math.min(8, value.presetRows.length + 1)} aria-label="Rows" autoComplete="off" className={INPUT} disabled={disabled} value={rowsToText(value.presetRows)} data-testid="rows-text"
                onChange={(e) => set({ presetRows: textToRows(e.target.value) })} />
              <p className="mt-1 text-[11px] text-gray-400">One row per line. The text before “|” fills the first column, the next the second, and so on; the applicant fills in the remaining columns and can neither add nor remove rows. E.g. “Your company”, “Competitor 1”, “Competitor 2”.</p>
            </div>
          )}
        </div>
      )}
      <div>
        <span className={LABEL}>Questions in each entry</span>
        <ul className="mt-1 space-y-2">
          {value.subFields.map((s, i) => (
            <SubFieldEditor key={s.id} sub={s} index={i} total={value.subFields.length} disabled={disabled} onChange={(n) => setSub(s.id, n)}
              onRemove={() => set({ subFields: value.subFields.filter((x) => x.id !== s.id) })} onMove={(d) => move(i, d)} />
          ))}
        </ul>
        <button type="button" disabled={disabled || value.subFields.length >= MAX_GROUP_SUBFIELDS} onClick={() => set({ subFields: [...value.subFields, newSubField('short_text')] })}
          className="mt-2 text-xs font-medium text-[#0E7490] hover:underline disabled:opacity-40" data-testid="add-subfield">+ Add a question</button>
      </div>
    </div>
  );
}
