'use client';
// Prompt 905 — Calls editor, tab "Form" (spec §6): the form builder. Interaction kept simple on purpose: add a field
// from a menu of types, drag to reorder (or use the arrows), edit in the side panel. Pages are split and merged by
// hand, or proposed by "Suggest pages" (by subject, about five per page, no AI). Display conditions only point at
// EARLIER questions; links to platform data are explicit and shown with an icon.
import { useMemo, useState } from 'react';
import { orderFields } from '@/lib/calls/form-logic';
import {
  addOption, appendField, changeKind, deleteField, mergePageWithPrevious, moveField, removeOption, renameOption, splitPageAt, suggestPages,
} from '@/lib/calls/form-builder';
import {
  CONDITION_OPERATOR_LABELS, DEFAULT_MAX_FILE_MB, FIELD_KINDS, FIELD_KIND_LABELS, MAPPABLE_KINDS, MAX_FILE_MB_CEILING, PLATFORM_MAPPINGS, isChoiceKind,
  platformMappingLabel, type ConditionOperator, type FieldKind, type FormField,
} from '@/lib/calls/types';

const KIND_ICON: Record<FieldKind, string> = {
  short_text: 'Aa', long_text: '¶', number: '#', date: '📅', yes_no: '✓✗', single_choice: '◉', multiple_choice: '☑', file: '📄',
};
const INPUT = 'block w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-500';

function conditionText(f: FormField, all: FormField[]): string | null {
  const c = f.condition;
  if (!c) return null;
  const ctl = all.find((x) => x.id === c.fieldId);
  if (!ctl) return 'Shown if a deleted question…';
  const value = ctl.options.find((o) => o.id === c.value)?.label;
  const op = CONDITION_OPERATOR_LABELS[c.operator];
  return `Shown if “${ctl.label}” ${op}${c.operator === 'equals' || c.operator === 'not_equals' ? ` ${value ?? '…'}` : ''}`;
}

export function FormTab({ fields, disabled, onChange }: { fields: FormField[]; disabled: boolean; onChange: (next: FormField[]) => void }) {
  const ordered = useMemo(() => orderFields(fields), [fields]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const selected = ordered.find((f) => f.id === selectedId) ?? null;
  const pages = [...new Set(ordered.map((f) => f.page))];

  function add(kind: FieldKind) {
    const { fields: next, added } = appendField(fields, kind);
    onChange(next);
    setSelectedId(added.id);
    setMenuOpen(false);
    setNotice('');
  }
  function drop(targetIndex: number) {
    if (!dragId) return;
    const res = moveField(fields, dragId, targetIndex);
    setNotice(res.refused ?? '');
    onChange(res.fields);
    setDragId(null);
  }
  function step(id: string, dir: -1 | 1) {
    const at = ordered.findIndex((f) => f.id === id);
    const res = moveField(fields, id, at + dir);
    setNotice(res.refused ?? '');
    onChange(res.fields);
  }
  const update = (id: string, patch: Partial<FormField>) => onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]" data-testid="form-tab">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <button type="button" disabled={disabled} onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40" data-testid="add-field">
              + Add field
            </button>
            {menuOpen && (
              <ul role="menu" className="absolute left-0 z-20 mt-1 w-52 rounded-lg border border-gray-200 bg-white py-1 shadow-lg" data-testid="field-menu">
                {FIELD_KINDS.map((k) => (
                  <li key={k}>
                    <button type="button" role="menuitem" onClick={() => add(k)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50">
                      <span className="w-6 text-center text-xs text-gray-400">{KIND_ICON[k]}</span>{FIELD_KIND_LABELS[k]}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" disabled={disabled || ordered.length < 2} data-testid="suggest-pages"
            onClick={() => {
              if (pages.length > 1 && !window.confirm('Replace the current page breaks with the suggested ones? Your questions and their order stay as they are.')) return;
              onChange(suggestPages(fields));
              setNotice('Pages suggested by subject — adjust them as you like.');
            }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">Suggest pages</button>
          <span className="text-xs text-gray-400">{ordered.length} field{ordered.length === 1 ? '' : 's'} · {pages.length || 0} page{pages.length === 1 ? '' : 's'}</span>
        </div>
        {notice && <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="form-notice">{notice}</p>}

        {ordered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400" data-testid="form-empty">
            No questions yet. Use <b>Add field</b> to start — a short text question is a good first one.
          </p>
        ) : (
          <div className="space-y-5">
            {pages.map((page, pi) => (
              <section key={page} aria-label={`Page ${pi + 1}`}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Page {pi + 1}</h3>
                  {pi > 0 && !disabled && (
                    <button type="button" onClick={() => onChange(mergePageWithPrevious(fields, page))} className="text-[11px] text-gray-400 hover:text-[#0E7490]">Merge with previous page</button>
                  )}
                </div>
                <ul className="space-y-2">
                  {ordered.filter((f) => f.page === page).map((f, fi) => {
                    const flatIndex = ordered.findIndex((x) => x.id === f.id);
                    const cond = conditionText(f, ordered);
                    return (
                      <li key={f.id} data-testid="field-card">
                        {fi > 0 && !disabled && (
                          <button type="button" onClick={() => onChange(splitPageAt(fields, f.id))} className="mb-1 block text-[10px] text-gray-300 hover:text-[#0E7490]" title="Start a new page before this question">— new page here —</button>
                        )}
                        <div draggable={!disabled}
                          onDragStart={() => setDragId(f.id)} onDragEnd={() => setDragId(null)}
                          onDragOver={(e) => { if (dragId) e.preventDefault(); }} onDrop={() => drop(flatIndex)}
                          onClick={() => setSelectedId(f.id)}
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border bg-white p-3 ${selectedId === f.id ? 'border-[#0E7490] ring-1 ring-[#0E7490]' : 'border-gray-200 hover:border-gray-300'} ${dragId === f.id ? 'opacity-50' : ''}`}>
                          <span className="mt-0.5 cursor-grab select-none text-gray-300" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
                          <span className="mt-0.5 w-7 shrink-0 rounded bg-gray-100 text-center text-[11px] font-semibold text-gray-500" aria-hidden="true">{KIND_ICON[f.kind]}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-900">{f.label}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-400">
                              <span>{FIELD_KIND_LABELS[f.kind]}</span>
                              {f.required && <span className="font-semibold text-[#B00000]">Required</span>}
                              {f.platformMapping && <span className="text-[#0E7490]" title="Linked to platform data">🔗 {platformMappingLabel(f.platformMapping)}</span>}
                              {cond && <span className="text-amber-700">⤷ {cond}</span>}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col">
                            <button type="button" aria-label="Move up" disabled={disabled || flatIndex === 0} onClick={(e) => { e.stopPropagation(); step(f.id, -1); }} className="rounded px-1 text-xs text-gray-400 hover:bg-gray-100 disabled:opacity-30">↑</button>
                            <button type="button" aria-label="Move down" disabled={disabled || flatIndex === ordered.length - 1} onClick={(e) => { e.stopPropagation(); step(f.id, 1); }} className="rounded px-1 text-xs text-gray-400 hover:bg-gray-100 disabled:opacity-30">↓</button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start" aria-label="Field settings">
        {selected ? (
          <FieldPanel
            field={selected} ordered={ordered} disabled={disabled}
            onChange={(patch) => update(selected.id, patch)} onReplace={(f) => onChange(fields.map((x) => (x.id === f.id ? f : x)))}
            onDelete={() => { onChange(deleteField(fields, selected.id)); setSelectedId(null); }}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">Select a field to edit it here.</p>
        )}
      </aside>
    </div>
  );
}

function FieldPanel({ field, ordered, disabled, onChange, onReplace, onDelete }: {
  field: FormField; ordered: FormField[]; disabled: boolean;
  onChange: (patch: Partial<FormField>) => void; onReplace: (f: FormField) => void; onDelete: () => void;
}) {
  const earlier = ordered.slice(0, ordered.findIndex((x) => x.id === field.id));
  const controller = field.condition ? earlier.find((x) => x.id === field.condition!.fieldId) : null;
  const optionControl = controller ? isChoiceKind(controller.kind) || controller.kind === 'yes_no' : false;
  const operators: ConditionOperator[] = optionControl ? ['equals', 'not_equals', 'is_answered', 'is_empty'] : ['is_answered', 'is_empty'];

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4" data-testid="field-panel">
      <div>
        <label className={LABEL} htmlFor="fp-kind">Type</label>
        <select id="fp-kind" className={INPUT} value={field.kind} disabled={disabled} onChange={(e) => onReplace(changeKind(field, e.target.value as FieldKind))}>
          {FIELD_KINDS.map((k) => <option key={k} value={k}>{FIELD_KIND_LABELS[k]}</option>)}
        </select>
      </div>
      <div>
        <label className={LABEL} htmlFor="fp-label">{field.kind === 'file' ? 'Document name' : 'Question'}</label>
        <textarea id="fp-label" rows={2} autoComplete="off" className={INPUT} value={field.label} disabled={disabled} maxLength={500} onChange={(e) => onChange({ label: e.target.value })} />
      </div>
      <div>
        <label className={LABEL} htmlFor="fp-instr">{field.kind === 'file' ? 'Description' : 'Instruction (optional)'}</label>
        <textarea id="fp-instr" rows={2} autoComplete="off" className={INPUT} value={field.instruction ?? ''} disabled={disabled} maxLength={2000} onChange={(e) => onChange({ instruction: e.target.value || null })} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={field.required} disabled={disabled} onChange={(e) => onChange({ required: e.target.checked })} /> Required
      </label>
      <p className="-mt-2 text-[11px] text-gray-400">A required question must be answered. It does not exclude anyone by itself — only an eligibility rule does.</p>

      {field.kind === 'yes_no' && <p className="rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-500">Yes / No — no answer is pre-selected.</p>}
      {isChoiceKind(field.kind) && (
        <div>
          <span className={LABEL}>Options</span>
          <ul className="mt-1 space-y-1.5">
            {field.options.map((o) => (
              <li key={o.id} className="flex items-center gap-1.5">
                <input aria-label="Option text" autoComplete="off" className={INPUT} value={o.label} disabled={disabled} maxLength={300} onChange={(e) => onReplace(renameOption(field, o.id, e.target.value))} />
                <button type="button" aria-label="Remove option" disabled={disabled} onClick={() => onReplace(removeOption(field, o.id))} className="rounded px-1.5 text-gray-400 hover:text-[#B00000] disabled:opacity-30">✕</button>
              </li>
            ))}
          </ul>
          <button type="button" disabled={disabled} onClick={() => onReplace(addOption(field))} className="mt-2 text-xs font-medium text-[#0E7490] hover:underline disabled:opacity-40">+ Add option</button>
          <p className="mt-1 text-[11px] text-gray-400">Renaming an option never breaks the rules that use it.</p>
        </div>
      )}

      {(field.kind === 'short_text' || field.kind === 'long_text') && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={LABEL} htmlFor="fp-maxlen">Max characters</label>
            <input id="fp-maxlen" type="number" min={1} autoComplete="off" className={INPUT} disabled={disabled} value={field.validations.maxLength ?? ''}
              onChange={(e) => onChange({ validations: { ...field.validations, maxLength: e.target.value ? Number(e.target.value) : undefined } })} />
          </div>
          {field.kind === 'long_text' && (
            <div>
              <label className={LABEL} htmlFor="fp-maxwords">Max words</label>
              <input id="fp-maxwords" type="number" min={1} autoComplete="off" className={INPUT} disabled={disabled} value={field.validations.maxWords ?? ''}
                onChange={(e) => onChange({ validations: { ...field.validations, maxWords: e.target.value ? Number(e.target.value) : undefined } })} />
            </div>
          )}
        </div>
      )}
      {field.kind === 'number' && (
        <div>
          <p className="rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-500">Digits only — no letters, commas, dots or negative values. The value is shown formatted underneath as it is typed.</p>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!field.validations.currency} disabled={disabled} onChange={(e) => onChange({ validations: { ...field.validations, currency: e.target.checked || undefined } })} />
            Show the call&apos;s currency (e.g. “500 000 €”)
          </label>
        </div>
      )}
      {field.kind === 'file' && (
        <div className="space-y-2">
          <p className="rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-500">PDF files only.</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={LABEL} htmlFor="fp-mb">Max size (MB)</label>
              <input id="fp-mb" type="number" min={1} max={MAX_FILE_MB_CEILING} autoComplete="off" className={INPUT} disabled={disabled} value={field.validations.maxFileMb ?? DEFAULT_MAX_FILE_MB}
                onChange={(e) => onChange({ validations: { ...field.validations, maxFileMb: e.target.value ? Number(e.target.value) : undefined } })} />
            </div>
            <div>
              <label className={LABEL} htmlFor="fp-age">Valid for (months)</label>
              <input id="fp-age" type="number" min={1} autoComplete="off" className={INPUT} disabled={disabled} placeholder="no limit" value={field.maxAgeMonths ?? ''}
                onChange={(e) => onChange({ maxAgeMonths: e.target.value ? Number(e.target.value) : null })} />
            </div>
          </div>
          <div>
            <label className={LABEL} htmlFor="fp-expected">Expected type</label>
            <input id="fp-expected" autoComplete="off" className={INPUT} disabled={disabled} placeholder="e.g. Financial statements" maxLength={200} value={field.expectedType ?? ''}
              onChange={(e) => onChange({ expectedType: e.target.value || null })} />
          </div>
        </div>
      )}

      {MAPPABLE_KINDS.includes(field.kind) && (
        <div>
          <label className={LABEL} htmlFor="fp-map">Link to platform data</label>
          <select id="fp-map" className={INPUT} value={field.platformMapping ?? ''} disabled={disabled} onChange={(e) => onChange({ platformMapping: (e.target.value || null) as FormField['platformMapping'] })}>
            <option value="">Not linked</option>
            {PLATFORM_MAPPINGS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-gray-400">The applicant sees it prefilled from their profile and can edit it. Once edited, it is never overwritten.</p>
        </div>
      )}

      <div>
        <span className={LABEL}>Display condition</span>
        {!field.condition ? (
          <button type="button" disabled={disabled || earlier.length === 0} onClick={() => onChange({ condition: { fieldId: earlier[earlier.length - 1].id, operator: 'is_answered', value: null } })}
            className="mt-1 block text-xs font-medium text-[#0E7490] hover:underline disabled:text-gray-400 disabled:no-underline"
            title={earlier.length === 0 ? 'A condition needs an earlier question to depend on' : undefined}>
            + Show only if…
          </button>
        ) : (
          <div className="mt-1 space-y-1.5 rounded-lg bg-amber-50 p-2.5" data-testid="condition-editor">
            <select aria-label="Depends on" className={INPUT} disabled={disabled} value={field.condition.fieldId}
              onChange={(e) => onChange({ condition: { fieldId: e.target.value, operator: 'is_answered', value: null } })}>
              {earlier.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            <select aria-label="Operator" className={INPUT} disabled={disabled} value={field.condition.operator}
              onChange={(e) => onChange({ condition: { ...field.condition!, operator: e.target.value as ConditionOperator, value: null } })}>
              {operators.map((o) => <option key={o} value={o}>{CONDITION_OPERATOR_LABELS[o]}</option>)}
            </select>
            {(field.condition.operator === 'equals' || field.condition.operator === 'not_equals') && controller && (
              <select aria-label="Value" className={INPUT} disabled={disabled} value={field.condition.value ?? ''}
                onChange={(e) => onChange({ condition: { ...field.condition!, value: e.target.value || null } })}>
                <option value="">Choose…</option>
                {controller.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            )}
            <button type="button" disabled={disabled} onClick={() => onChange({ condition: null })} className="text-[11px] text-gray-500 hover:text-[#B00000]">Remove condition</button>
          </div>
        )}
        <p className="mt-1 text-[11px] text-gray-400">A required question that is hidden by its condition never blocks the applicant.</p>
      </div>

      <button type="button" disabled={disabled} onClick={onDelete} className="text-xs font-medium text-[#B00000] hover:underline disabled:opacity-40" data-testid="delete-field">Delete this field</button>
    </div>
  );
}
