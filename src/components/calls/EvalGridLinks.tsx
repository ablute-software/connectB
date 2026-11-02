'use client';
// Prompt 922 (Adenda 1, B; simplified by Adenda 2, 02/11/2026) — the pieces of the Evaluation grid step that tie a criterion to the form. ONE way to link: the chips on the criterion's card (number and the start of the
// question, ✕ to unlink) and the button "Link questions", which opens a panel with a search box, filters, the pages folded and the questions loaded by parts — never a long list inside the card, never two lists at once.
// The same panel, with several choices, makes "Create from questions" (one criterion per question), and, read-only and opened on "Not linked yet", it is "Form coverage". "Score automatically from answers" (the table of
// points of one closed question) lives in the card's "More options". Nothing here decides anything: the server reads the same links and the same table.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { autoProblems, blankAuto, rangeText, type AutoScore } from '@/lib/calls/eval-auto';
import { byPage, chipText, criteriaByField, fieldTitle, type LinkableField } from '@/lib/calls/eval-links';
import { scaleLevels, type Criterion } from '@/lib/calls/eval-grid';

const INPUT = 'block w-full min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500';
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wide text-gray-500';
const BTN = 'min-h-[44px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 sm:py-1 sm:text-xs';
const PRIMARY = 'min-h-[44px] rounded-lg bg-[#0E7490] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40 sm:min-h-0';

type Scale = { scaleMin: number; scaleMax: number };

/** The questions linked to a criterion, as chips; a notice when it came from a template; a proposal read from a document (applied only when accepted); and the button that opens the panel. */
export function LinkedChips({ d, fields, editable, suggestion, locked, onChange, onOpen }: {
  d: { id: string; name: string; linkedFields?: string[]; linkNotice?: boolean }; fields: LinkableField[]; editable: boolean; suggestion?: string[]; /** The question the criterion scores itself from: it stays linked. */ locked?: string;
  onChange: (linked: string[]) => void; onOpen: () => void;
}) {
  const linked = d.linkedFields ?? [];
  const known = (id: string) => fields.find((f) => f.id === id);
  const proposed = (suggestion ?? []).filter((id) => known(id) && !linked.includes(id));
  return (
    <div className="min-w-0" data-testid="criterion-links">
      <p className={LABEL}>Based on these answers</p>
      {d.linkNotice && linked.length === 0 && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900" data-testid="criterion-link-notice">Link this criterion to the questions of this call.</p>}
      {linked.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Linked questions">
          {linked.map((id) => {
            const f = known(id);
            return (
              <li key={id} title={f ? fieldTitle(f) : undefined} className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${f ? 'border-[#BAD9E3] bg-[#E8F4F8] text-[#0A5F75]' : 'border-[#f2b8b8] bg-[#fdecec] text-[#b00000]'}`} data-testid="criterion-link" data-field={id}>
                <span className="min-w-0 truncate">{f ? chipText(f) : 'A question that was removed from the form'}</span>
                {editable && id !== locked && <button type="button" aria-label={`Unlink ${f ? f.label : 'the removed question'}`} className="shrink-0 px-1 text-sm leading-none hover:text-[#B00000]" data-testid="criterion-unlink" onClick={() => onChange(linked.filter((x) => x !== id))}>×</button>}
              </li>
            );
          })}
        </ul>
      )}
      {editable && proposed.map((id) => (
        <p key={id} className="mt-1.5 flex flex-wrap items-center gap-2 rounded bg-gray-50 px-2 py-1 text-xs text-gray-700" data-testid="criterion-suggestion">
          <span className="min-w-0 [overflow-wrap:anywhere]">The text of this criterion points to “{fieldTitle(known(id)!)}”.</span>
          <button type="button" className={BTN} data-testid="criterion-suggestion-accept" onClick={() => onChange([...linked, id])}>Link it</button>
        </p>
      ))}
      {editable && <button type="button" className={`${BTN} mt-1.5`} data-testid="criterion-link-open" onClick={onOpen}>Link questions{linked.length ? ` (${linked.length})` : ''}</button>}
      {!editable && linked.length === 0 && <p className="mt-1 text-xs text-gray-500">No question linked.</p>}
    </div>
  );
}

const PAGE_STEP = 30;

/**
 * The panel of questions: a drawer on a computer, the whole screen on a phone. `link`: the questions of one criterion (checkboxes, "Done"); `create`: several questions at once, one criterion each ("Create N criteria");
 * `coverage`: only to look, with "Not linked yet" on. A search by number or by text, filters by page and by link, the pages folded (open only where the search found something), and the questions loaded by parts.
 */
export function QuestionPicker({ mode, fields, criteria, currentId, selected, locked, onToggle, onDone, onClose }: {
  mode: 'link' | 'create' | 'coverage'; fields: LinkableField[]; criteria: Pick<Criterion, 'id' | 'name' | 'linkedFields'>[]; currentId?: string; selected: string[]; locked?: string;
  onToggle: (id: string) => void; onDone: () => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState('');
  const [notLinked, setNotLinked] = useState(mode === 'coverage');
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE_STEP);
  const search = useRef<HTMLInputElement>(null);
  const by = useMemo(() => criteriaByField(criteria), [criteria]);
  useEffect(() => { search.current?.focus(); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  useEffect(() => { setLimit(PAGE_STEP); }, [query, page, notLinked, mine]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => fields.filter((f) => {
    if (page && String(f.page) !== page) return false;
    if (notLinked && (by.get(f.id)?.length ?? 0) > 0) return false;
    if (mine && !selected.includes(f.id)) return false;
    if (q && !(String(f.number) === q || String(f.number).startsWith(q) || f.label.toLowerCase().includes(q))) return false;
    return true;
  }), [fields, page, notLinked, mine, q, by, selected]);
  const pages = byPage(shown);
  const pagesAll = byPage(fields);
  const searching = q !== '' || page !== '';
  let budget = limit;
  const linkedCount = fields.filter((f) => (by.get(f.id)?.length ?? 0) > 0).length;
  const title = mode === 'link' ? 'Link questions' : mode === 'create' ? 'Create from questions' : `Form coverage (${linkedCount} / ${fields.length})`;

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label={title} data-testid="question-picker" data-mode={mode} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex h-full w-full min-w-0 flex-col bg-white shadow-xl lg:max-w-md">
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <h3 className="min-w-0 text-sm font-semibold text-gray-900">{title}</h3>
          <button type="button" className="min-h-[44px] min-w-[44px] rounded px-2 text-lg text-gray-500 hover:text-gray-900 sm:min-h-0 sm:min-w-0" aria-label="Close" data-testid="picker-close" onClick={onClose}>×</button>
        </div>
        <div className="space-y-2 border-b border-gray-100 px-4 py-3">
          <input ref={search} type="search" autoComplete="off" aria-label="Search by number or text" placeholder="Search by number or text" className={INPUT} value={query} data-testid="picker-search" onChange={(e) => setQuery(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Page" className={`${INPUT} !w-auto`} value={page} data-testid="picker-page" onChange={(e) => setPage(e.target.value)}>
              <option value="">All pages</option>{pagesAll.map((p) => <option key={p.page} value={p.page}>Page {p.page}</option>)}
            </select>
            <button type="button" aria-pressed={notLinked} className={`${BTN} ${notLinked ? '!border-[#0E7490] !bg-[#E8F4F8] !text-[#0A5F75]' : ''}`} data-testid="picker-not-linked" onClick={() => setNotLinked((v) => !v)}>Not linked yet</button>
            {mode === 'link' && <button type="button" aria-pressed={mine} className={`${BTN} ${mine ? '!border-[#0E7490] !bg-[#E8F4F8] !text-[#0A5F75]' : ''}`} data-testid="picker-mine" onClick={() => setMine((v) => !v)}>Linked to this criterion</button>}
          </div>
          <p className="text-xs text-gray-500" role="status" data-testid="picker-count">{shown.length} of {fields.length} question{fields.length === 1 ? '' : 's'}{mode === 'coverage' ? ` · ${linkedCount} linked` : mode === 'link' ? ` · ${selected.length} chosen` : ` · ${selected.length} chosen`}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2" data-testid="picker-list">
          {fields.length === 0 && <p className="py-6 text-center text-sm text-gray-500">The form has no questions yet.</p>}
          {fields.length > 0 && shown.length === 0 && <p className="py-6 text-center text-sm text-gray-500" data-testid="picker-empty">{notLinked && !q && !page ? 'Every question is linked to a criterion.' : 'No question matches.'}</p>}
          {pages.map((p) => {
            const isOpen = searching || open.has(p.page);
            return (
              <section key={p.page} className="border-b border-gray-100 py-1 last:border-0" data-testid="picker-page-group" data-page={p.page}>
                <button type="button" aria-expanded={isOpen} className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 sm:min-h-0 sm:py-1.5" data-testid="picker-page-toggle"
                  onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(p.page)) n.delete(p.page); else n.add(p.page); return n; })}>
                  <span>Page {p.page} · {p.fields.length} question{p.fields.length === 1 ? '' : 's'}</span><span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <ul className="mb-1">
                    {p.fields.filter(() => budget-- > 0).map((f) => {
                      const others = (by.get(f.id) ?? []).filter((c) => c.id !== currentId);
                      const checked = selected.includes(f.id);
                      return (
                        <li key={f.id} className="min-w-0" data-testid="picker-question" data-field={f.id}>
                          {mode === 'coverage' ? (
                            <div className="min-h-[44px] py-1.5 text-sm text-gray-800 sm:min-h-0">
                              <span className="[overflow-wrap:anywhere]">{fieldTitle(f)}{f.kind === 'file' ? ' (document)' : ''}</span>
                              <span className="ml-1 text-xs text-gray-500" data-testid="picker-linked-to">{others.length ? `→ ${others.map((c) => c.name || 'Unnamed').join(', ')}` : 'not linked'}</span>
                            </div>
                          ) : (
                            <label className="flex min-h-[44px] min-w-0 cursor-pointer items-start gap-2 rounded px-1 py-1.5 text-sm text-gray-800 hover:bg-gray-50 sm:min-h-0">
                              <input type="checkbox" className="mt-1 shrink-0" checked={checked} disabled={f.id === locked} data-testid={`link-${f.id}`} onChange={() => onToggle(f.id)} />
                              <span className="min-w-0"><span className="[overflow-wrap:anywhere]">{fieldTitle(f)}{f.kind === 'file' ? ' (document)' : ''}</span>
                                {others.length > 0 && <span className="block text-[11px] text-gray-500" data-testid="picker-also">Also linked to: {others.map((c) => c.name || 'Unnamed').join(', ')}</span>}</span>
                            </label>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
          {(() => { const total = pages.reduce((n, p) => n + ((searching || open.has(p.page)) ? p.fields.length : 0), 0); return total > limit ? <button type="button" className={`${BTN} my-2`} data-testid="picker-more" onClick={() => setLimit((l) => l + PAGE_STEP)}>Show more ({total - limit} left)</button> : null; })()}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-4 py-3">
          {mode === 'create' && <button type="button" className={BTN} data-testid="picker-cancel" onClick={onClose}>Cancel</button>}
          {mode === 'create'
            ? <button type="button" className={PRIMARY} disabled={selected.length === 0} data-testid="picker-create" onClick={onDone}>{selected.length === 0 ? 'Create criteria' : `Create ${selected.length} criteri${selected.length === 1 ? 'on' : 'a'}`}</button>
            : <button type="button" className={PRIMARY} data-testid="picker-done" onClick={onDone}>{mode === 'link' ? 'Done' : 'Close'}</button>}
        </div>
      </div>
    </div>,
    document.body,
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
