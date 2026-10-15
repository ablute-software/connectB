// Prompt 909 (I2) — import the form of another call (no AI): the fields, the pages, the display conditions, the
// validations, the links to platform data and the expected documents, copied into this call. Pure; the route applies
// it and the editor shows the warnings. Two modes:
//   replace  the imported form becomes THE form;
//   add      the imported pages go after the existing ones, which are not touched.
// Every field gets a new id (field ids are unique across all calls); option ids stay as they are, because they only
// matter inside their own field and the conditions that point at them are carried over with it.
import { newFieldId } from './form-builder';
import { orderFields } from './form-logic';
import type { FormField } from './types';

export type ImportMode = 'replace' | 'add';
export const isImportMode = (v: unknown): v is ImportMode => v === 'replace' || v === 'add';

export interface ImportResult {
  /** The whole form after the import. */
  fields: FormField[];
  /** How many fields came in. */
  imported: number;
  warnings: string[];
}

export function importForm(
  current: FormField[], source: FormField[], mode: ImportMode, makeId: () => string = newFieldId,
): ImportResult {
  const ordered = orderFields(source);
  const pageOrder = [...new Set(ordered.map((f) => f.page))].sort((a, b) => a - b);
  const pageIndex = new Map(pageOrder.map((p, i) => [p, i + 1]));
  const offset = mode === 'add' ? Math.max(0, ...current.map((f) => f.page)) : 0;
  const idMap = new Map(ordered.map((f) => [f.id, makeId()]));

  const warnings: string[] = [];
  const perPage = new Map<number, number>();
  const imported: FormField[] = ordered.map((f) => {
    const page = offset + (pageIndex.get(f.page) ?? 1);
    const position = perPage.get(page) ?? 0;
    perPage.set(page, position + 1);
    let condition = f.condition ? { ...f.condition } : null;
    if (condition) {
      const target = idMap.get(condition.fieldId);
      if (target) condition = { ...condition, fieldId: target };
      else {
        condition = null;
        warnings.push(`“${f.label}” had a display condition on a question that was not imported, so the condition was removed.`);
      }
    }
    return {
      ...f, id: idMap.get(f.id)!, page, position, condition,
      options: f.options.map((o) => ({ ...o })), validations: JSON.parse(JSON.stringify(f.validations)) as typeof f.validations,
    };
  });

  return { fields: mode === 'replace' ? imported : [...current, ...imported], imported: imported.length, warnings };
}

/** What the chooser shows for each call of the organisation: enough to recognise it. */
export interface ImportSource { id: string; name: string; status: string; effectiveStatus: string; fields: number; phases: number }
