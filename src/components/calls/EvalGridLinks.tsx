'use client';
// Prompt 922 (Adenda 1, B) — the pieces of the Evaluation grid step that tie a criterion to the form: "Based on these answers" (the questions and documents the evaluator reads beside the criterion, listed by page with
// their number), "Score automatically from answers" (the table of points of one closed question), and the side panel "Form questions" (the whole form while the grid is built, each question with the criteria it is
// linked to, so what is left unevaluated is seen). Nothing here decides anything: the server reads the same links and the same table.
import { useState } from 'react';
import { autoProblems, blankAuto, rangeText, type AutoScore } from '@/lib/calls/eval-auto';
import { byPage, criteriaByField, fieldTitle, type LinkableField } from '@/lib/calls/eval-links';
import { scaleLevels, type Criterion } from '@/lib/calls/eval-grid';

const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-500';
const BTN = 'min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';

type Scale = { scaleMin: number; scaleMax: number };

/** "Based on these answers": the linked questions as chips, and a list by page to add or remove them. */
export function LinkPicker({ d, fields, editable, suggestion, locked, onChange }: {
  d: { id: string; name: string; linkedFields?: string[]; linkNotice?: boolean }; fields: LinkableField[]; editable: boolean; suggestion?: string[]; /** The question the criterion scores itself from: it stays linked. */ locked?: string; onChange: (linked: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const linked = d.linkedFields ?? [];
  const known = (id: string) => fields.find((f) => f.id === id);
  const toggle = (id: string) => onChange(linked.includes(id) ? linked.filter((x) => x !== id) : [...linked, id]);
  const proposed = (suggestion ?? []).filter((id) => known(id) && !linked.includes(id));
  return (
    <div className="mt-2 min-w-0 rounded bg-gray-50 px-2.5 py-2" data-testid="criterion-links">
      <p className={LABEL}>Based on these answers</p>
      {d.linkNotice && linked.length === 0 && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900" data-testid="criterion-link-notice">Link this criterion to the questions of this call.</p>}
      {linked.length === 0 ? <p className="mt-1 text-xs text-gray-500" data-testid="criterion-no-links">No question linked: the evaluator reads the whole application.</p> : (
        <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Linked questions">
          {linked.map((id) => {
            const f = known(id);
            return (
              <li key={id} className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${f ? 'border-[#BAD9E3] bg-[#E8F4F8] text-[#0A5F75]' : 'border-[#f2b8b8] bg-[#fdecec] text-[#b00000]'}`} data-testid="criterion-link" data-field={id}>
                <span className="min-w-0 [overflow-wrap:anywhere]">{f ? fieldTitle(f) : 'A question that was removed from the form'}</span>
                {editable && id !== locked && <button type="button" aria-label={`Unlink ${f ? f.label : 'the removed question'}`} className="shrink-0 px-1 text-sm leading-none hover:text-[#B00000]" data-testid="criterion-unlink" onClick={() => toggle(id)}>×</button>}
              </li>
            );
          })}
        </ul>
      )}
      {editable && proposed.map((id) => (
        <p key={id} className="mt-1.5 flex flex-wrap items-center gap-2 rounded bg-white px-2 py-1 text-xs text-gray-700" data-testid="criterion-suggestion">
          <span className="min-w-0 [overflow-wrap:anywhere]">The text of this criterion points to “{fieldTitle(known(id)!)}”.</span>
          <button type="button" className={BTN} data-testid="criterion-suggestion-accept" onClick={() => toggle(id)}>Link it</button>
        </p>
      ))}
      {editable && (
        <button type="button" className={`${BTN} mt-1.5`} aria-expanded={open} data-testid="criterion-link-open" onClick={() => setOpen((o) => !o)}>{open ? 'Done' : linked.length ? 'Change the questions…' : 'Choose the questions…'}</button>
      )}
      {open && editable && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2" role="group" aria-label="Questions of the form" data-testid="criterion-link-list">
          {fields.length === 0 && <p className="text-xs text-gray-500">The form has no questions yet.</p>}
          {byPage(fields).map((p) => (
            <fieldset key={p.page} className="mb-2 min-w-0 last:mb-0">
              <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Page {p.page}</legend>
              {p.fields.map((f) => (
                <label key={f.id} className="flex min-h-[44px] min-w-0 items-start gap-2 rounded px-1 py-1 text-sm text-gray-800 hover:bg-gray-50 sm:min-h-0">
                  <input type="checkbox" className="mt-1 shrink-0" checked={linked.includes(f.id)} disabled={f.id === locked} data-testid={`link-${f.id}`} onChange={() => toggle(f.id)} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{fieldTitle(f)}{f.kind === 'file' ? ' (document)' : ''}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}

const pointsOptions = (c: Scale) => scaleLevels(c);

function PointsSelect({ id, label, value, scale, disabled, onChange }: { id: string; label: string; value: number | null; scale: Scale; disabled: boolean; onChange: (v: number | null) => void }) {
  return (
    <select id={id} aria-label={label} className={`${INPUT} !w-24 shrink-0`} disabled={disabled} value={value === null ? '' : String(value)} data-testid={id}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      <option value="">— points</option>{pointsOptions(scale).map((p) => <option key={p} value={p}>{p}</option>)}
    </select>
  );
}

/** "Score automatically from answers": choose the question, then give points to every answer. An incomplete table is saved as it is, and said so — the call cannot be validated until it is complete. */
export function AutoEditor({ d, fields, editable, onChange }: {
  d: Pick<Criterion, 'id' | 'name' | 'scaleMin' | 'scaleMax' | 'auto' | 'linkedFields'>; fields: LinkableField[]; editable: boolean; onChange: (auto: AutoScore | null, linked?: string[]) => void;
}) {
  const auto = d.auto ?? null;
  const field = auto ? fields.find((f) => f.id === auto.fieldId) : undefined;
  const scorable = fields.filter((f) => f.canScore);
  const set = (patch: Partial<AutoScore>) => auto && onChange({ ...auto, ...patch });
  const problems = auto ? autoProblems(auto, field && { kind: field.kind, label: field.label, options: field.options }, d.name || 'This criterion') : [];
  return (
    <div className="mt-2 min-w-0 rounded bg-gray-50 px-2.5 py-2" data-testid="criterion-auto">
      <label className="flex items-start gap-2 text-sm text-gray-800">
        <input type="checkbox" className="mt-1" checked={!!auto} disabled={!editable || (scorable.length === 0 && !auto)} data-testid="auto-toggle"
          onChange={(e) => { if (!e.target.checked) onChange(null); else if (scorable[0]) onChange(blankAuto(scorable[0]), [...new Set([scorable[0].id, ...(d.linkedFields ?? [])])]); }} />
        <span><b>Score automatically from answers.</b> The criterion arrives already scored from one closed answer; the evaluator does not choose.{scorable.length === 0 && !auto ? ' (The form has no closed question yet: single choice, multiple choice, Yes/No or number.)' : ''}</span>
      </label>
      {auto && (
        <div className="mt-2 space-y-2">
          <div>
            <label className={LABEL} htmlFor={`af-${d.id}`}>Scored from the question</label>
            <select id={`af-${d.id}`} className={INPUT} disabled={!editable} value={auto.fieldId} data-testid="auto-field"
              onChange={(e) => { const f = fields.find((x) => x.id === e.target.value); if (f) onChange(blankAuto(f), [...new Set([f.id, ...(d.linkedFields ?? []).filter((x) => x !== auto.fieldId)])]); }}>
              {!field && <option value={auto.fieldId}>A question that was removed from the form</option>}
              {scorable.map((f) => <option key={f.id} value={f.id}>{fieldTitle(f)}</option>)}
            </select>
          </div>
          {field && (field.kind === 'single_choice' || field.kind === 'multiple_choice') && (
            <ul className="space-y-1.5" aria-label="Points of each answer">
              {field.options.map((o) => (
                <li key={o.id} className="flex min-w-0 items-center justify-between gap-2"><span className="min-w-0 text-sm text-gray-800 [overflow-wrap:anywhere]">{o.label}</span>
                  <PointsSelect id={`ap-${d.id}-${o.id}`} label={`Points for ${o.label}`} value={auto.options[o.id] ?? null} scale={d} disabled={!editable} onChange={(v) => set({ options: { ...auto.options, [o.id]: v } })} /></li>
              ))}
            </ul>
          )}
          {field?.kind === 'multiple_choice' && (
            <div role="radiogroup" aria-label="How the options chosen count" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-800">
              {(['sum', 'max'] as const).map((m) => <label key={m} className="flex items-center gap-1.5"><input type="radio" name={`am-${d.id}`} checked={auto.multi === m} disabled={!editable} data-testid={`auto-multi-${m}`} onChange={() => set({ multi: m })} /> {m === 'sum' ? 'Add up the points of the options chosen' : 'The highest of the options chosen'}</label>)}
              <span className="basis-full text-[11px] text-gray-500">Never above the top of the scale.</span>
            </div>
          )}
          {field?.kind === 'yes_no' && (
            <ul className="space-y-1.5" aria-label="Points of each answer">
              <li className="flex items-center justify-between gap-2"><span className="text-sm text-gray-800">Yes</span><PointsSelect id={`ap-${d.id}-yes`} label="Points for Yes" value={auto.yes} scale={d} disabled={!editable} onChange={(v) => set({ yes: v })} /></li>
              <li className="flex items-center justify-between gap-2"><span className="text-sm text-gray-800">No</span><PointsSelect id={`ap-${d.id}-no`} label="Points for No" value={auto.no} scale={d} disabled={!editable} onChange={(v) => set({ no: v })} /></li>
            </ul>
          )}
          {field?.kind === 'number' && (
            <div>
              <ul className="space-y-1.5" aria-label="Points of each range">
                {auto.ranges.map((r, i) => (
                  <li key={i} className="flex min-w-0 flex-wrap items-center gap-2" data-testid="auto-range">
                    <span className="w-20 shrink-0 text-xs text-gray-500">{i === 0 ? 'Up to' : i === auto.ranges.length - 1 ? 'Over' : 'Up to'}</span>
                    {i === auto.ranges.length - 1 ? <span className="min-w-0 flex-1 text-sm text-gray-800">{rangeText(auto.ranges, i)}</span> : (
                      <input inputMode="decimal" autoComplete="off" aria-label={`Upper limit of range ${i + 1}`} className={`${INPUT} !w-32`} disabled={!editable} value={r.upTo ?? ''} data-testid={`auto-limit-${i}`}
                        onChange={(e) => { const t = e.target.value.replace(/[^\d.-]/g, ''); const n = t === '' || t === '-' ? null : Number(t); set({ ranges: auto.ranges.map((x, j) => (j === i ? { ...x, upTo: Number.isFinite(n as number) ? n : null } : x)) }); }} />
                    )}
                    <PointsSelect id={`ap-${d.id}-r${i}`} label={`Points for range ${i + 1}`} value={r.points} scale={d} disabled={!editable} onChange={(v) => set({ ranges: auto.ranges.map((x, j) => (j === i ? { ...x, points: v } : x)) })} />
                    {editable && auto.ranges.length > 1 && i < auto.ranges.length - 1 && <button type="button" aria-label={`Remove range ${i + 1}`} className="px-1 text-gray-400 hover:text-[#B00000]" onClick={() => set({ ranges: auto.ranges.filter((_, j) => j !== i) })}>✕</button>}
                  </li>
                ))}
              </ul>
              {editable && <button type="button" className={`${BTN} mt-1.5`} data-testid="auto-add-range" onClick={() => set({ ranges: [...auto.ranges.slice(0, -1), { upTo: null, points: null }, auto.ranges[auto.ranges.length - 1]] })}>+ Add a range</button>}
              <p className="mt-1 text-[11px] text-gray-500">Each range runs from just above the previous limit up to its own; the last one has no limit, so every value is covered.</p>
            </div>
          )}
          <label className="flex items-start gap-2 text-sm text-gray-800"><input type="checkbox" className="mt-1" checked={auto.override} disabled={!editable} data-testid="auto-override" onChange={(e) => set({ override: e.target.checked })} />
            <span>Evaluators may override. A changed score then needs a comment, and both the automatic value and the new one are kept.</span></label>
          {problems.length > 0 && (
            <ul className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900" role="status" data-testid="auto-problems">
              {problems.map((p) => <li key={p}>⚠ {p}</li>)}
              <li className="mt-0.5 text-amber-800">Saved as it is; the call cannot be validated until every answer has points.</li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** The whole form, beside the grid: each question with the criteria that look at it. A question linked to nothing is not evaluated by this grid. */
export function FormQuestionsPanel({ fields, criteria }: { fields: LinkableField[]; criteria: Pick<Criterion, 'id' | 'name' | 'linkedFields'>[] }) {
  const by = criteriaByField(criteria);
  const unlinked = fields.filter((f) => !by.has(f.id)).length;
  return (
    <section className="min-w-0 rounded-lg border border-gray-200 bg-white p-3 lg:sticky lg:top-2 lg:max-h-[calc(100vh-1rem)] lg:overflow-y-auto" aria-label="Form questions" data-testid="form-questions">
      <h4 className="text-sm font-semibold text-gray-900">Form questions</h4>
      <p className="mt-0.5 text-xs text-gray-600" data-testid="form-questions-summary">{fields.length === 0 ? 'The form has no questions yet.' : criteria.length === 0 ? `${fields.length} question${fields.length === 1 ? '' : 's'} in the form.` : unlinked === 0 ? 'Every question is linked to a criterion.' : `${unlinked} of ${fields.length} question${fields.length === 1 ? ' is' : 's are'} not linked to any criterion.`}</p>
      {byPage(fields).map((p) => (
        <div key={p.page} className="mt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Page {p.page}</p>
          <ul className="mt-1 space-y-1.5">
            {p.fields.map((f) => {
              const cs = by.get(f.id) ?? [];
              return (
                <li key={f.id} className="min-w-0 text-sm text-gray-800" data-testid="form-question" data-field={f.id} data-linked={cs.length > 0 ? 'true' : 'false'}>
                  <span className="[overflow-wrap:anywhere]">{fieldTitle(f)}</span>
                  <span className="ml-1 text-xs">
                    {cs.length === 0 ? <span className="text-gray-400" data-testid="form-question-unlinked">{criteria.length > 0 ? 'not linked' : ''}</span>
                      : cs.map((c) => <span key={c.id} className="mr-1 inline-block max-w-full rounded-full bg-[#E8F4F8] px-1.5 py-0.5 text-[#0A5F75] [overflow-wrap:anywhere]" data-testid="form-question-criterion">{c.name || 'Unnamed'}</span>)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
