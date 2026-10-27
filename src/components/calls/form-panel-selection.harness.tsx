// Prompt 917 (27/10/2026) — a tiny host for the REAL FormTab, bundled into a real browser by form-panel-selection.browser.test.ts. It keeps the fields in state the way CallEditor does and can open
// on a question the way "What is missing → go to this question" does (selectId + selectKey). Test-only: nothing in the app imports it.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FormField } from '@/lib/calls/types';
import { FormTab } from './FormTab';

declare global { interface Window { __start: (initial: FormField[], jumpTo?: string) => void; __fields: FormField[] } }

function Host({ initial, jumpTo }: { initial: FormField[]; jumpTo?: string }) {
  const [fields, setFields] = useState(initial);
  window.__fields = fields;
  return (
    <FormTab callId="c1" fields={fields} disabled={false} lockedReason={null} onChange={(next) => { window.__fields = next; setFields(next); }}
      onImport={async () => ({ ok: false, error: 'not here' } as never)} onImportDocuments={() => {}} selectId={jumpTo} selectKey={jumpTo ? 1 : 0} />
  );
}

window.__start = (initial, jumpTo) => { createRoot(document.getElementById('root')!).render(<Host initial={initial} jumpTo={jumpTo} />); };
