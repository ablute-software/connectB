// An answer as text, for reading (option labels, not ids). Pure; the Applications screen, the rules of the eligibility and the tests read it.
import { formatNumberDisplay } from './form-logic';
import { entriesOf, fileValues, groupOf } from './field-config';
import { isTableAnswered, tableSummary } from './table';
import type { AnswerValue, FormField } from './types';

export function answerText(field: FormField, value: AnswerValue, currency: string): string {
  if (value == null || value === '') return '—';
  if (field.kind === 'table') return isTableAnswered(value) ? tableSummary(field, value) : '—';
  if (field.kind === 'group') { const n = entriesOf(value).length; const g = groupOf(field); return n === 0 ? '—' : `${n} ${(g?.entryLabel ?? 'entry').toLowerCase()}${n === 1 ? '' : ' entries'}`; }
  if (Array.isArray(value)) {
    if (field.kind === 'file') return fileValues(value).map((f) => f.fileName).join(', ') || '—';
    return (value as unknown[]).map((id) => field.options.find((o) => o.id === id)?.label ?? String(id)).join(', ') || '—';
  }
  if (typeof value === 'object') return (value as { fileName: string }).fileName;
  if (field.kind === 'yes_no' && (value === 'yes' || value === 'no')) return value === 'yes' ? 'Yes' : 'No';
  if (field.kind === 'yes_no' || field.kind === 'single_choice') return field.options.find((o) => o.id === value)?.label ?? value;
  if (field.kind === 'number') return formatNumberDisplay(value, field.validations.currency ? currency : null);
  return value;
}

