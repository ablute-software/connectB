// Prompt 704 (18/09/2026) — pulled out of confirm.tsx so it's testable
// without a DOM: confirm.tsx is a 'use client' component with JSX, and this
// project's vitest has no jsdom/@testing-library (see FrostedGate.test.ts's
// own header) — importing a function straight out of a .tsx file breaks the
// test transform, the same reason account-mode.ts exists next to
// AccountModeSwitch.tsx. This file stays plain .ts on purpose.
export interface ConfirmField {
  key: string;
  label: string;
  type: 'date' | 'text';
  defaultValue?: string;
  placeholder?: string;
  min?: string;
  // pipeline-drop.ts's drag-to-requalify dialogs need a reason that can't be
  // skipped ("campo de razão obrigatório antes de gravar"). Optional so
  // every existing caller (none of which set it) is unaffected.
  required?: boolean;
}

export type ConfirmValues = Record<string, string>;

/** Whether every required field actually has a value. */
export function hasMissingRequiredField(fields: ConfirmField[] | undefined, values: ConfirmValues): boolean {
  return (fields ?? []).some((f) => f.required && !values[f.key]?.trim());
}
