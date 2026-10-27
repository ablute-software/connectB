// Prompt 917 (Adenda 2, B2) — a tiny host for the REAL TableInput, bundled into a real browser by table-input.browser.test.ts. It keeps the answer in state the way the application form does and
// counts the changes (each one is what the draft's autosave listens to). Test-only: nothing in the app imports it.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AnswerValue, FormField } from '@/lib/calls/types';
import { TableInput } from './TableInput';

declare global { interface Window { __startTable: (field: FormField, initial: AnswerValue, opts?: { disabled?: boolean }) => void; __answer: AnswerValue; __changes: number } }

function Host({ field, initial, disabled }: { field: FormField; initial: AnswerValue; disabled?: boolean }) {
  const [value, setValue] = useState<AnswerValue>(initial);
  window.__answer = value;
  return (
    <div style={{ padding: 16 }}>
      <TableInput field={field} value={value} currency="EUR" disabled={disabled} onChange={(v) => { window.__changes = (window.__changes ?? 0) + 1; window.__answer = v; setValue(v); }} />
    </div>
  );
}

window.__startTable = (field, initial, opts) => { window.__changes = 0; createRoot(document.getElementById('root')!).render(<Host field={field} initial={initial} disabled={opts?.disabled} />); };
