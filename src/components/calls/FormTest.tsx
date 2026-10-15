'use client';
// Prompt 909 (I5) — "Test the form": the form exactly as the applicant will fill it. Required questions enforced,
// conditions live, the validations of each field, "Next" blocked while something on the page is missing, and at the
// end the final check with the list of what is missing. A banner says so all the way through: nothing is saved or
// submitted. THE ANSWERS LIVE IN THIS COMPONENT'S STATE ONLY: they never leave the browser (this file does not talk to
// the server, to storage or to anything else), they vanish when the person leaves, and they never create an
// application or count anywhere. Available to whoever may configure the call, in any state.
import { useMemo, useState } from 'react';
import { visiblePages } from '@/lib/calls/form-logic';
import { TEST_BANNER, testStep, type FinalIssue } from '@/lib/calls/preview-logic';
import type { Answers, AnswerValue, FormField, PlatformMappingKey } from '@/lib/calls/types';
import { FieldInput } from './FieldInput';

const SAMPLES: Record<PlatformMappingKey, string> = {
  company_name: 'Acme Robotics', country: 'Portugal', person_name: 'Alex Example', person_role: 'CEO',
  sector: 'Industrial automation', stage: 'Seed', website: 'https://acme.example',
};

export function FormTest({ fields, currency, title, onExit }: { fields: FormField[]; currency: string; title?: string; onExit: () => void }) {
  // Platform-linked questions come pre-filled, like the real form's, and can be changed.
  const initial = useMemo(() => {
    const a: Answers = {};
    for (const f of fields) if (f.platformMapping) a[f.id] = SAMPLES[f.platformMapping];
    return a;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.map((f) => `${f.id}:${f.platformMapping ?? ''}`).join('|')]);
  const [answers, setAnswers] = useState<Answers>({});
  const [pageIndex, setPageIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [final, setFinal] = useState<FinalIssue[] | null>(null);

  const merged: Answers = { ...initial, ...answers };
  const pages = visiblePages(fields, merged);
  const index = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const current = pages[index];
  const last = index >= pages.length - 1;

  const set = (id: string, v: AnswerValue) => { setAnswers((a) => ({ ...a, [id]: v })); setErrors((e) => { const { [id]: _drop, ...rest } = e; return rest; }); setFinal(null); };

  function next() {
    const step = testStep(fields, merged, index);
    if (step.kind === 'blocked') { setErrors(step.errors); return; }
    setErrors({});
    if (step.kind === 'next') setPageIndex(step.index); else setFinal(step.issues);
  }
  function restart() { setAnswers({}); setPageIndex(0); setErrors({}); setFinal(null); }

  const banner = (
    <p className="rounded-t-xl bg-amber-100 px-5 py-2 text-xs font-semibold text-amber-900" role="status" data-testid="test-banner">{TEST_BANNER}</p>
  );

  if (fields.length === 0) {
    return <div className="rounded-xl border border-gray-200 bg-white">{banner}<p className="p-6 text-center text-sm text-gray-400">The form is empty. Add questions in the Form tab to test it.</p></div>;
  }

  if (final) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white" data-testid="test-final">
        {banner}
        <div className="space-y-3 p-6">
          {final.length === 0 ? (
            <>
              <p className="text-base font-semibold text-gray-900">Final check: everything is complete</p>
              <p className="text-sm text-gray-500">In the real form, this is where the applicant submits. Here nothing is saved or sent.</p>
            </>
          ) : (
            <>
              <p className="text-base font-semibold text-gray-900">Final check: {final.length} thing{final.length === 1 ? ' is' : 's are'} missing</p>
              <ul className="space-y-1.5 text-sm" data-testid="final-issues">
                {final.map((i) => (
                  <li key={i.fieldId} className="flex items-start justify-between gap-3 rounded-lg bg-red-50 px-3 py-2">
                    <span className="text-gray-800"><b>Page {i.pageNumber}</b> · {i.label}<span className="block text-xs text-[#B00000]">{i.message}</span></span>
                    <button type="button" className="shrink-0 text-xs font-semibold text-[#0E7490] hover:underline"
                      onClick={() => { setPageIndex(Math.max(0, i.pageNumber - 1)); setFinal(null); setErrors(Object.fromEntries(final.filter((x) => x.page === i.page).map((x) => [x.fieldId, x.message]))); }}>Go to the page</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={restart} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Start again</button>
            <button type="button" onClick={onExit} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50" data-testid="exit-test">Exit test</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-white" data-testid="form-test">
      {banner}
      <div className="border-b border-gray-100 px-5 py-3">
        {title && <p className="text-sm font-semibold text-gray-900">{title}</p>}
        <div className="mt-2 flex items-center gap-2" aria-label={`Page ${index + 1} of ${pages.length}`}>
          <div className="h-1.5 flex-1 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-[#0E7490] transition-all" style={{ width: `${((index + 1) / pages.length) * 100}%` }} /></div>
          <span className="text-xs text-gray-500" data-testid="page-indicator">Page {index + 1} of {pages.length}</span>
        </div>
      </div>
      <div className="space-y-5 px-5 py-5">
        {current.fields.map((f) => <FieldInput key={f.id} field={f} value={merged[f.id]} error={errors[f.id]} currency={currency} showAllErrors={!!errors[f.id]} onChange={(v) => set(f.id, v)} />)}
      </div>
      {Object.keys(errors).length > 0 && <p role="alert" className="px-5 pb-2 text-xs font-medium text-[#B00000]" data-testid="blocked">Something on this page needs your attention before you can continue.</p>}
      <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
        <button type="button" disabled={index === 0} onClick={() => { setErrors({}); setPageIndex(index - 1); }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">Back</button>
        <span className="flex items-center gap-3">
          <button type="button" onClick={onExit} className="text-xs text-gray-500 hover:underline" data-testid="exit-test">Exit test</button>
          <button type="button" onClick={next} data-testid="test-next" className="rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b]">{last ? 'Finish' : 'Next'}</button>
        </span>
      </div>
    </div>
  );
}
