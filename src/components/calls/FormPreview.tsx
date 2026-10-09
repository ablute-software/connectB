'use client';
// Prompt 905 — the form as a candidate will see it, page by page, with the display conditions working. A
// PREVIEW: it validates like the real thing (the same functions the server will use) but saves nothing, and says
// so. Fields linked to platform data show a sample value, editable, as the real form will show the profile's.
import { useMemo, useState } from 'react';
import { validatePage, visiblePages } from '@/lib/calls/form-logic';
import type { Answers, AnswerValue, FormField, PlatformMappingKey } from '@/lib/calls/types';
import { FieldInput } from './FieldInput';

const SAMPLES: Record<PlatformMappingKey, string> = {
  company_name: 'Acme Robotics', country: 'Portugal', person_name: 'Alex Example', person_role: 'CEO',
  sector: 'Industrial automation', stage: 'Seed', website: 'https://acme.example',
};

export function FormPreview({ fields, currency, title }: { fields: FormField[]; currency: string; title?: string }) {
  const initial = useMemo(() => {
    const a: Answers = {};
    for (const f of fields) if (f.platformMapping) a[f.id] = SAMPLES[f.platformMapping];
    return a;
    // Re-seed only when the set of mapped fields changes, never while someone is typing in the preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.map((f) => `${f.id}:${f.platformMapping ?? ''}`).join('|')]);
  const [answers, setAnswers] = useState<Answers>({});
  const [pageIndex, setPageIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [finished, setFinished] = useState(false);

  // Samples for mapped fields, overridden by whatever was typed.
  const merged: Answers = { ...initial, ...answers };
  const pages = visiblePages(fields, merged);
  const safeIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const current = pages[safeIndex];

  const set = (id: string, v: AnswerValue) => { setAnswers((a) => ({ ...a, [id]: v })); setErrors((e) => { const { [id]: _drop, ...rest } = e; return rest; }); };

  if (fields.length === 0) {
    return <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400" data-testid="preview-empty">The form is empty. Add questions in the Form tab to preview it.</p>;
  }

  if (finished) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center" data-testid="preview-finished">
        <p className="text-base font-semibold text-gray-900">That is the whole form</p>
        <p className="mt-1 text-sm text-gray-500">This was a preview: nothing was saved or sent.</p>
        <button type="button" onClick={() => { setFinished(false); setPageIndex(0); setErrors({}); }} className="mt-4 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Start again</button>
      </div>
    );
  }

  const last = safeIndex >= pages.length - 1;
  function next() {
    const errs = validatePage(fields, merged, current.page);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    if (last) setFinished(true); else setPageIndex(safeIndex + 1);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white" data-testid="form-preview">
      <div className="border-b border-gray-100 px-5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Preview — nothing is saved</p>
        {title && <p className="mt-0.5 text-sm font-semibold text-gray-900">{title}</p>}
        <div className="mt-2 flex items-center gap-2" aria-label={`Page ${safeIndex + 1} of ${pages.length}`}>
          <div className="h-1.5 flex-1 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-[#0E7490] transition-all" style={{ width: `${((safeIndex + 1) / pages.length) * 100}%` }} /></div>
          <span className="text-xs text-gray-500" data-testid="page-indicator">Page {safeIndex + 1} of {pages.length}</span>
        </div>
      </div>
      <div className="space-y-5 px-5 py-5">
        {current.fields.map((f) => (
          <FieldInput key={f.id} field={f} value={merged[f.id]} error={errors[f.id]} currency={currency} onChange={(v) => set(f.id, v)} />
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
        <button type="button" disabled={safeIndex === 0} onClick={() => { setErrors({}); setPageIndex(safeIndex - 1); }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">Back</button>
        <button type="button" onClick={next} className="rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b]">
          {last ? 'Finish preview' : 'Next'}
        </button>
      </div>
    </div>
  );
}
