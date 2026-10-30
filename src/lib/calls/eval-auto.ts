// Prompt 922 (Adenda 1, B) — a criterion that scores ITSELF from a closed answer of the application (Nuno, 29/10/2026), pure: the table of points the entity defines for one closed question (single choice,
// multiple choice, Yes/No, a number or an amount), what a given answer is worth, what is still missing in the table, and what an evaluation holds for such a criterion.
//
// The rules, all of them here and nowhere else:
//   • the table must give points to EVERY option (and cover every value of a number, without gaps or overlaps) before the call can be validated — an incomplete table is saved while it is built, never used;
//   • the evaluator does not choose: the criterion arrives scored and marked "Automatic". The entity may allow an override; a changed score then needs a comment, and both values are kept;
//   • no answer (the question was not shown, or left empty) = "Needs manual score": the evaluator scores by hand;
//   • while the evaluation is not submitted the point follows the application (a corrected answer recalculates it); after submitting it is fixed, and a later difference is only a warning for the administrator;
//   • a number is read against ranges written as "up to X": each range runs from just above the previous limit up to its own, and the last one has no limit, so no value can fall between two ranges.
// Points are always whole numbers inside the criterion's own scale. A multiple choice adds the points of the options chosen (or takes the highest), never above the scale.
import type { FormField } from './types';

export const AUTO_KINDS = ['single_choice', 'multiple_choice', 'yes_no', 'number'] as const;
export type AutoKind = (typeof AUTO_KINDS)[number];
export const MAX_AUTO_RANGES = 20;

export interface AutoRange { /** The highest value this range holds; null = no limit (the last range). */ upTo: number | null; points: number | null }
export interface AutoScore {
  fieldId: string;
  kind: AutoKind;
  /** single / multiple choice: the points of each option, by option id (null = not given yet). */
  options: Record<string, number | null>;
  /** Yes/No. */
  yes: number | null; no: number | null;
  /** Number or amount: the ranges, in ascending order of `upTo`, the last one without a limit. */
  ranges: AutoRange[];
  /** Multiple choice: the points of the options chosen are added up ("sum") or the highest one counts ("max"). */
  multi: 'sum' | 'max';
  /** "Evaluators may override": the evaluator may change the score, with a comment. Off by default. */
  override: boolean;
}

export const isAutoKind = (k: string): k is AutoKind => (AUTO_KINDS as readonly string[]).includes(k);
/** A question that can score a criterion by itself: a closed one, at the top level of the form. */
export const isAutoField = (f: Pick<FormField, 'kind'>): boolean => isAutoKind(f.kind);

export function blankAuto(f: Pick<FormField, 'id' | 'kind' | 'options'>): AutoScore {
  return {
    fieldId: f.id, kind: f.kind as AutoKind, options: Object.fromEntries(f.options.map((o) => [o.id, null])), yes: null, no: null,
    ranges: f.kind === 'number' ? [{ upTo: null, points: null }] : [], multi: 'sum', override: false,
  };
}

type Scale = { scaleMin: number; scaleMax: number };
const isPoints = (v: unknown, s: Scale): v is number => typeof v === 'number' && Number.isInteger(v) && v >= s.scaleMin && v <= s.scaleMax;
const pts = (v: unknown, s: Scale): number | null | undefined => (v === null || v === undefined || v === '' ? null : isPoints(v, s) ? v : undefined);

/**
 * The table the editor sent, read strictly but WITHOUT demanding that it is complete (it is saved while it is built): every number must be a whole number inside the scale, every option must belong to the
 * question, the limits of the ranges must grow. Completeness is `autoProblems`, which stops the call from being validated, not the editing.
 */
export function parseAuto(raw: unknown, field: Pick<FormField, 'id' | 'kind' | 'label' | 'options'> | undefined, s: Scale, name: string): { ok: true; auto: AutoScore } | { ok: false; error: string } {
  const where = `“${name}”`;
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!r) return { ok: false, error: `${where}: the automatic scoring is not valid.` };
  if (!field) return { ok: false, error: `${where} scores itself from a question that is not in the form: choose another or switch the automatic scoring off.` };
  if (!isAutoField(field)) return { ok: false, error: `${where}: a question of this kind cannot score a criterion by itself (single choice, multiple choice, Yes/No, number or amount do).` };
  const out = blankAuto(field);
  const bad = `${where}: the points of the answers must be whole numbers from ${s.scaleMin} to ${s.scaleMax}.`;
  if (field.kind === 'single_choice' || field.kind === 'multiple_choice') {
    const given = (r.options && typeof r.options === 'object' ? r.options : {}) as Record<string, unknown>;
    for (const id of Object.keys(given)) if (!field.options.some((o) => o.id === id)) return { ok: false, error: `${where}: an answer in the table is not an option of “${field.label}”.` };
    for (const o of field.options) { const v = pts(given[o.id], s); if (v === undefined) return { ok: false, error: bad }; out.options[o.id] = v; }
    out.multi = field.kind === 'multiple_choice' && r.multi === 'max' ? 'max' : 'sum';
  } else if (field.kind === 'yes_no') {
    const y = pts(r.yes, s); const n = pts(r.no, s);
    if (y === undefined || n === undefined) return { ok: false, error: bad };
    out.yes = y; out.no = n;
  } else {
    const ranges = Array.isArray(r.ranges) ? (r.ranges as Record<string, unknown>[]) : [];
    if (ranges.length > MAX_AUTO_RANGES) return { ok: false, error: `${where}: at most ${MAX_AUTO_RANGES} ranges.` };
    const list: AutoRange[] = [];
    let last = -Infinity;
    for (let i = 0; i < ranges.length; i++) {
      const x = ranges[i] ?? {};
      const p = pts(x.points, s);
      if (p === undefined) return { ok: false, error: bad };
      let upTo: number | null = null;
      if (x.upTo !== null && x.upTo !== undefined && x.upTo !== '') {
        upTo = typeof x.upTo === 'number' ? x.upTo : Number(x.upTo);
        if (!Number.isFinite(upTo)) return { ok: false, error: `${where}: the limit of range ${i + 1} is not a number.` };
        if (upTo <= last) return { ok: false, error: `${where}: the limits of the ranges must grow (range ${i + 1} ends at ${upTo}, not above ${last}).` };
        last = upTo;
      } else if (i !== ranges.length - 1) return { ok: false, error: `${where}: only the last range can have no limit.` };
      list.push({ upTo, points: p });
    }
    out.ranges = list.length ? list : [{ upTo: null, points: null }];
  }
  out.override = r.override === true;
  return { ok: true, auto: out };
}

const fmt = (n: number): string => n.toLocaleString('en-GB').replace(/,/g, ' ');

/** What is still missing in the table, in words, for the "Review" of the call (an empty list = the table is complete). */
export function autoProblems(auto: AutoScore, field: Pick<FormField, 'kind' | 'label' | 'options'> | undefined, name: string): string[] {
  const where = `“${name}”`;
  if (!field) return [`${where} scores itself from a question that is not in the form any more.`];
  if (field.kind !== auto.kind) return [`${where}: the question “${field.label}” changed kind: set the points again.`];
  const out: string[] = [];
  if (auto.kind === 'single_choice' || auto.kind === 'multiple_choice') {
    const missing = field.options.filter((o) => auto.options[o.id] === null || auto.options[o.id] === undefined);
    for (const o of missing) out.push(`${where}: give points to the answer “${o.label}”.`);
  } else if (auto.kind === 'yes_no') {
    if (auto.yes === null) out.push(`${where}: give points to “Yes”.`);
    if (auto.no === null) out.push(`${where}: give points to “No”.`);
  } else {
    if (auto.ranges.length === 0) out.push(`${where}: add the ranges of “${field.label}”.`);
    auto.ranges.forEach((r, i) => { if (r.points === null) out.push(`${where}: give points to ${rangeText(auto.ranges, i)}.`); });
    const last = auto.ranges[auto.ranges.length - 1];
    if (last && last.upTo !== null) out.push(`${where}: the last range must have no limit, so that every value is covered.`);
  }
  return out;
}

/** "up to 50 000", "over 50 000 and up to 250 000", "over 250 000" */
export function rangeText(ranges: AutoRange[], i: number): string {
  const prev = i > 0 ? ranges[i - 1].upTo : null;
  const cur = ranges[i];
  if (cur.upTo === null) return prev === null ? 'any value' : `over ${fmt(prev)}`;
  return prev === null ? `up to ${fmt(cur.upTo)}` : `over ${fmt(prev)} and up to ${fmt(cur.upTo)}`;
}

export type AutoResult = { status: 'scored'; points: number; because: string } | { status: 'missing'; because: string };

/** What an answer is worth. The question's own answer is read the way the form stores it (option id, option ids, 'yes' / 'no', digits). */
export function autoPoints(auto: AutoScore, field: Pick<FormField, 'kind' | 'options' | 'label'> | undefined, answer: unknown, s: Scale): AutoResult {
  const none = (because: string): AutoResult => ({ status: 'missing', because });
  if (!field || field.kind !== auto.kind) return none('The question is not in the form any more.');
  const clamp = (n: number) => Math.max(s.scaleMin, Math.min(s.scaleMax, n));
  const labelOf = (id: string) => field.options.find((o) => o.id === id)?.label ?? id;
  if (auto.kind === 'single_choice') {
    const id = typeof answer === 'string' ? answer : '';
    const p = id ? auto.options[id] : undefined;
    return typeof p === 'number' ? { status: 'scored', points: clamp(p), because: labelOf(id) } : none(id ? 'This answer has no points in the table.' : 'The question was not answered.');
  }
  if (auto.kind === 'multiple_choice') {
    const ids = Array.isArray(answer) ? (answer as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const got = ids.map((id) => ({ id, p: auto.options[id] })).filter((x): x is { id: string; p: number } => typeof x.p === 'number');
    if (got.length === 0) return none(ids.length ? 'These answers have no points in the table.' : 'The question was not answered.');
    const total = auto.multi === 'max' ? Math.max(...got.map((g) => g.p)) : got.reduce((n, g) => n + g.p, 0);
    return { status: 'scored', points: clamp(total), because: got.map((g) => labelOf(g.id)).join(', ') };
  }
  if (auto.kind === 'yes_no') {
    const p = answer === 'yes' ? auto.yes : answer === 'no' ? auto.no : undefined;
    return typeof p === 'number' ? { status: 'scored', points: clamp(p), because: answer === 'yes' ? 'Yes' : 'No' } : none(answer === 'yes' || answer === 'no' ? 'This answer has no points in the table.' : 'The question was not answered.');
  }
  const text = typeof answer === 'string' ? answer.trim() : '';
  const v = text === '' ? NaN : Number(text.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(v)) return none('The question was not answered.');
  for (const r of auto.ranges) {
    if (r.upTo === null || v <= r.upTo) return typeof r.points === 'number' ? { status: 'scored', points: clamp(r.points), because: fmt(v) } : none('This value has no points in the table.');
  }
  return none('This value is outside the ranges of the table.');
}

/** What each automatic criterion of the grid is worth for THIS application, from the answers as they were given (a blind evaluation hides identities, never the closed answers that score). */
export function autoResultsFor(criteria: { id: string; scaleMin: number; scaleMax: number; auto?: AutoScore | null }[], fields: Pick<FormField, 'id' | 'kind' | 'options' | 'label'>[], answers: Record<string, unknown>): Record<string, AutoResult> {
  const out: Record<string, AutoResult> = {};
  for (const c of criteria) if (c.auto) out[c.id] = autoPoints(c.auto, fields.find((f) => f.id === c.auto!.fieldId), answers[c.auto.fieldId], c);
  return out;
}

// --- What an evaluation holds for such a criterion -----------------------------------------------------------------------------------------------

export type ScoreSource = 'manual' | 'auto' | 'override';
export interface HeldScore { score: number | null; comment: string; source?: ScoreSource; autoValue?: number | null }

/**
 * The score of one criterion as it must stand while the evaluation is NOT submitted. Not automatic: whatever is held. Automatic with an answer: the point of the answer — unless the entity allowed overriding and the
 * evaluator chose another value (kept as "override", with the automatic one beside it). Automatic without an answer: the evaluator's own score ("Needs manual score").
 */
export function resolveScore(auto: AutoScore | null | undefined, result: AutoResult | null, held: HeldScore | undefined): HeldScore {
  const comment = held?.comment ?? '';
  if (!auto || !result) return held ? { ...held, source: held.source ?? 'manual' } : { score: null, comment: '', source: 'manual' };
  if (result.status === 'missing') return { score: held?.source === 'auto' ? null : held?.score ?? null, comment, source: 'manual', autoValue: null };
  const chosen = auto.override && held?.source === 'override' && typeof held.score === 'number' && held.score !== result.points;
  return chosen ? { score: held.score, comment, source: 'override', autoValue: result.points } : { score: result.points, comment, source: 'auto', autoValue: result.points };
}

/** What the evaluator asks for when they change an automatic score: allowed only if the entity said so, and only to another value of the scale. */
export function overrideMove(auto: AutoScore | null | undefined, result: AutoResult | null): 'manual' | 'locked' | 'override' {
  if (!auto || !result || result.status === 'missing') return 'manual';
  return auto.override ? 'override' : 'locked';
}

/** The scores of an evaluation that is not submitted, with every automatic criterion following the application. */
export function liveScores<T extends HeldScore>(criteria: { id: string; auto?: AutoScore | null }[], held: Record<string, T>, results: Record<string, AutoResult>): Record<string, HeldScore> {
  const out: Record<string, HeldScore> = { ...held };
  for (const c of criteria) {
    if (!c.auto || !results[c.id]) continue;
    const r = resolveScore(c.auto, results[c.id], held[c.id]);
    if (r.score !== null || r.comment) out[c.id] = r; else delete out[c.id];
  }
  return out;
}

/** After submitting the points are fixed; this is the warning for the administrator when the application's answer says otherwise now. */
export function autoDrift(criteria: { id: string; name: string; auto?: AutoScore | null }[], held: Record<string, HeldScore>, results: Record<string, AutoResult>): { criterionId: string; name: string; held: number; now: number }[] {
  const out: { criterionId: string; name: string; held: number; now: number }[] = [];
  for (const c of criteria) {
    const h = held[c.id]; const r = results[c.id];
    if (!c.auto || !h || !r || r.status !== 'scored' || h.source === 'manual' || typeof h.autoValue !== 'number') continue;
    if (h.autoValue !== r.points) out.push({ criterionId: c.id, name: c.name, held: h.autoValue, now: r.points });
  }
  return out;
}
