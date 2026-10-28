// Prompt 923 — a tiny host for the REAL table previews, bundled into a real browser by table-preview.browser.test.ts: `panel` is the real TableEditor (its preview is the one in the editor's side panel),
// `review` is the real FormPreview with the table question in it (the preview of Review & publish). Test-only: nothing in the app imports it.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FormField, TableConfig } from '@/lib/calls/types';
import { FormPreview } from './FormPreview';
import { TableEditor } from './TableEditor';

declare global { interface Window { __startPreview: (kind: 'panel' | 'review', field: FormField, panelWidth: number) => void } }

function Panel({ field, width }: { field: FormField; width: number }) {
  const [cfg, setCfg] = useState<TableConfig>(field.validations.table as TableConfig);
  return <div style={{ width, padding: 12 }}><TableEditor value={cfg} onChange={setCfg} /></div>;
}

window.__startPreview = (kind, field, width) => {
  const root = createRoot(document.getElementById('root')!);
  root.render(kind === 'panel' ? <Panel field={field} width={width} /> : <div style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}><FormPreview fields={[field]} currency="EUR" title="Seed Call" /></div>);
};
