'use client';
// Prompt 917 (I1) — a repeatable group as the applicant answers it: "Add another", edit, reorder, remove; every entry validates its own required
// questions and the number of entries respects the minimum and the maximum. Used by the applicant's form, the editor's preview and the test mode, so the
// three can never drift. Two presentations: cards (one card per entry), or a table (the questions are the columns, the entries the rows; on a narrow
// screen the table becomes cards). When the entity pre-defined the rows, the text of their first columns is theirs: read-only, the applicant fills the
// rest and neither adds nor removes rows.
import { useEffect, useState } from 'react';
import { groupErrors, isAnswered } from '@/lib/calls/form-logic';
import { entriesOf, groupMin, groupOf, newEntry, subFieldAsField } from '@/lib/calls/field-config';
import type { AnswerValue, FormField, GroupEntry, SimpleAnswer, SubField } from '@/lib/calls/types';
import { FieldInput } from './FieldInput';

const BTN = 'rounded-lg border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40';

/** True on a narrow screen: a table of several columns does not fit there, so it is drawn as cards. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 640px)');
    const on = () => setNarrow(mq.matches);
    on(); mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return narrow;
}

export function GroupInput({ field, value, currency, disabled, showAllErrors, onChange, fileControlFor }: {
  field: FormField; value: AnswerValue; currency: string; disabled?: boolean;
  /** Show every problem (test mode, or after a failed attempt); otherwise only what was typed and is wrong. */
  showAllErrors?: boolean;
  onChange: (v: AnswerValue) => void;
  /** The applicant's own document control for a File question inside entry `entryId` (upload / Vault); the preview and the test use a plain file input. */
  fileControlFor?: (sub: SubField, entryId: string, entryValue: SimpleAnswer) => React.ReactNode;
}) {
  const cfg = groupOf(field);
  const narrow = useNarrow();
  if (!cfg) return null;
  const entries = entriesOf(value);
  const preset = cfg.presetRows.length > 0;
  const min = groupMin(field, cfg);
  const errors = groupErrors(field, value);
  const noun = cfg.entryLabel;
  const asTable = cfg.display === 'table' && !narrow;

  const set = (next: GroupEntry[]) => onChange(next);
  const setValue = (entryId: string, subId: string, v: SimpleAnswer) => set(entries.map((e) => (e.id === entryId ? { ...e, values: { ...e.values, [subId]: v } } : e)));
  const add = () => set([...entries, newEntry()]);
  const remove = (id: string) => set(entries.filter((e) => e.id !== id));
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= entries.length) return; const next = [...entries]; [next[i], next[j]] = [next[j], next[i]]; set(next); };
  const presetText = (rowIndex: number, col: number): string => (preset ? cfg.presetRows[rowIndex]?.[col] ?? '' : '');

  /** The problem of one question of one entry, shown when the question was answered wrongly — or always, when every problem is to be shown. */
  const errorFor = (e: GroupEntry, s: SubField): string | undefined => {
    const err = errors[`${e.id}/${s.id}`];
    return err && (showAllErrors || isAnswered(e.values[s.id]) || (typeof e.values[s.id] === 'string')) ? err : undefined;
  };
  const cell = (e: GroupEntry, s: SubField, rowIndex: number, col: number, compact: boolean) => {
    const text = presetText(rowIndex, col);
    if (text) return <span className="text-sm font-medium text-gray-900" data-testid="preset-cell">{text}</span>;
    const sub = subFieldAsField(s, col);
    return (
      <FieldInput field={sub} value={e.values[s.id]} error={errorFor(e, s)} currency={currency} disabled={disabled} idSuffix={e.id} compact={compact}
        onChange={(v) => setValue(e.id, s.id, v as SimpleAnswer)}
        fileControl={s.kind === 'file' && fileControlFor ? fileControlFor(s, e.id, e.values[s.id]) : undefined} />
    );
  };

  return (
    <div data-testid="group-input" data-display={asTable ? 'table' : 'cards'}>
      {entries.length === 0 && <p className="mb-2 text-xs text-gray-500" data-testid="group-empty">{min > 0 ? `Add at least ${min === 1 ? 'one' : min} ${noun.toLowerCase()}${min === 1 ? '' : ' entries'}.` : `No ${noun.toLowerCase()} added yet.`}</p>}
      {asTable ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200" data-testid="group-table">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>{cfg.subFields.map((s) => <th key={s.id} className="px-3 py-2 font-medium">{s.label}{s.required && <span className="ml-0.5 text-[#B00000]">*</span>}</th>)}<th className="w-24" /></tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.id} className="border-t border-gray-100 align-top" data-testid="group-entry">
                  {cfg.subFields.map((s, col) => <td key={s.id} className="px-3 py-2">{cell(e, s, i, col, true)}</td>)}
                  <td className="px-2 py-2 text-right">
                    {!disabled && !preset && (
                      <span className="inline-flex gap-1">
                        <button type="button" className={BTN} aria-label={`Move ${noun.toLowerCase()} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                        <button type="button" className={BTN} aria-label={`Move ${noun.toLowerCase()} ${i + 1} down`} disabled={i === entries.length - 1} onClick={() => move(i, 1)}>↓</button>
                        <button type="button" className={`${BTN} text-[#B00000]`} aria-label={`Remove ${noun.toLowerCase()} ${i + 1}`} disabled={entries.length <= min} onClick={() => remove(e.id)}>✕</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((e, i) => (
            <fieldset key={e.id} className="rounded-lg border border-gray-200 bg-white p-3" data-testid="group-entry">
              <legend className="px-1 text-xs font-semibold text-gray-600">{noun} {i + 1}</legend>
              <div className="space-y-3">
                {cfg.subFields.map((s, col) => {
                  const text = presetText(i, col);
                  return text ? (
                    <p key={s.id} className="text-sm"><span className="text-gray-500">{s.label}: </span><b className="text-gray-900" data-testid="preset-cell">{text}</b></p>
                  ) : (
                    <FieldInput key={s.id} field={subFieldAsField(s, col)} value={e.values[s.id]} error={errorFor(e, s)} currency={currency} disabled={disabled} idSuffix={e.id}
                      onChange={(v) => setValue(e.id, s.id, v as SimpleAnswer)}
                      fileControl={s.kind === 'file' && fileControlFor ? fileControlFor(s, e.id, e.values[s.id]) : undefined} />
                  );
                })}
              </div>
              {!disabled && !preset && (
                <div className="mt-2 flex gap-1.5">
                  <button type="button" className={BTN} aria-label={`Move ${noun.toLowerCase()} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑ Up</button>
                  <button type="button" className={BTN} aria-label={`Move ${noun.toLowerCase()} ${i + 1} down`} disabled={i === entries.length - 1} onClick={() => move(i, 1)}>↓ Down</button>
                  <button type="button" className={`${BTN} text-[#B00000]`} aria-label={`Remove ${noun.toLowerCase()} ${i + 1}`} disabled={entries.length <= min} onClick={() => remove(e.id)} data-testid="remove-entry">Remove</button>
                </div>
              )}
            </fieldset>
          ))}
        </div>
      )}
      {!disabled && !preset && (
        <div className="mt-2 flex items-center gap-3">
          <button type="button" className={BTN} disabled={entries.length >= cfg.max} onClick={add} data-testid="add-entry">+ Add another {noun.toLowerCase()}</button>
          <span className="text-[11px] text-gray-400" data-testid="entry-count">{entries.length} of {cfg.max}{min > 0 ? ` · at least ${min}` : ''}</span>
        </div>
      )}
      {errors.count && (showAllErrors || entries.length > cfg.max) && <p role="alert" className="mt-1 text-xs text-[#B00000]" data-testid="group-count-error">{errors.count}</p>}
    </div>
  );
}
