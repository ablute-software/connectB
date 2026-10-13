'use client';
// Prompt 905 / 909 (I5) — the form as an applicant will SEE it, for looking, not for filling in. FREE: every page and every
// question is reachable at once (Next, Back and a jump to any page), nothing is required, nothing is validated, nothing
// blocks. Under each question it says what the applicant will be asked ("Required", "Digits only", "PDF only, max 10 MB")
// and, for a conditional question, when it is shown. A switch ("Show as an applicant would see it") applies the conditions
// to what is typed here. To go through the form the way an applicant must — required enforced, Next blocked — there is
// the test mode (FormTest.tsx). Saves nothing, says so. Fields linked to platform data show a sample value, editable.
import { useMemo, useState } from 'react';
import { conditionNote, previewPages, validationHints } from '@/lib/calls/preview-logic';
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
  const [applicantView, setApplicantView] = useState(false);

  // Samples for mapped fields, overridden by whatever was typed.
  const merged: Answers = { ...initial, ...answers };
  const pages = previewPages(fields, applicantView, merged);
  const safeIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const current = pages[safeIndex];

  const set = (id: string, v: AnswerValue) => setAnswers((a) => ({ ...a, [id]: v }));

  if (fields.length === 0 || !current) {
    return <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400" data-testid="preview-empty">The form is empty. Add questions in the Form tab to preview it.</p>;
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
        {pages.length > 1 && (
          <nav className="mt-2 flex flex-wrap gap-1.5" aria-label="Go to a page" data-testid="page-jump">
            {pages.map((p, i) => (
              <button key={p.page} type="button" onClick={() => setPageIndex(i)} aria-current={i === safeIndex ? 'page' : undefined}
                className={`rounded-md border px-2 py-0.5 text-xs ${i === safeIndex ? 'border-[#0E7490] bg-[#E8F4F8] font-semibold text-[#0E7490]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{i + 1}</button>
            ))}
          </nav>
        )}
        <label className="mt-3 flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={applicantView} onChange={(e) => setApplicantView(e.target.checked)} data-testid="applicant-view" />
          Show as an applicant would see it
        </label>
        <p className="mt-1 text-[11px] text-gray-400">{applicantView ? 'Conditional questions appear only when their condition is met by what you type here.' : 'Every question is shown, conditional ones too, with the rule written under it.'}</p>
      </div>
      <div className="space-y-5 px-5 py-5">
        {current.fields.map((f) => {
          const hints = validationHints(f);
          const note = conditionNote(f, fields);
          return (
            <div key={f.id} data-testid="preview-field">
              <FieldInput field={f} value={merged[f.id]} currency={currency} onChange={(v) => set(f.id, v)} />
              {(hints.length > 0 || (note && !applicantView)) && (
                <p className="mt-1 text-[11px] text-gray-500" data-testid="field-hints">
                  {hints.join(' · ')}
                  {note && !applicantView && <span className="block italic text-gray-400" data-testid="condition-note">{note}</span>}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
        <button type="button" disabled={safeIndex === 0} onClick={() => setPageIndex(safeIndex - 1)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">Back</button>
        <button type="button" disabled={safeIndex >= pages.length - 1} onClick={() => setPageIndex(safeIndex + 1)}
          className="rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}
