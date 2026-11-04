// Prompt 925 — the selection of a call: minimums, places, budget, quotas and tie-breaks give a PROPOSAL of Advance / Waitlist / Reject, explained application by application. Nothing is decided here: the proposal is
// what a person with "Final decision" may apply. Pure and deterministic (no AI, no randomness, no order of arrival): the same applications and the same rules always give the same proposal.
//
// THE ORDER OF THE CALCULATION (it is written on the screen and in the report):
//   1. only applications that are Fit and have a final score take part (the others are "not considered");
//   2. the MINIMUMS are applied (the total, and each criterion; an eliminatory minimum of the grid counts as a minimum of that criterion) — whoever fails goes to Reject, with the reason;
//   3. the rest are ordered by the FINAL SCORE, with the tie-break chain (a criterion, then another, then a person decides — never order of arrival, never a draw);
//   4. the MINIMUM SEATS of the quotas are filled with the best of each category;
//   5. the REMAINING places are filled in order, respecting the MAXIMUM of each quota and the BUDGET (a project that does not fit is skipped — and the screen says so — and the next that fits is taken);
//   6. the next ones go to WAITLIST, up to the size of the waiting list;
//   7. everybody else goes to Reject ("Not within the available places").
import type { Criterion, Scoring } from './eval-grid';
import { scoreText } from './eval-grid';
import type { AnswerValue, FormField } from './types';

export type Outcome = 'selected' | 'waitlist' | 'reject' | 'not_considered';

export interface Quota {
  id: string; fieldId: string; label: string;
  /** What the answer has to be: one option, Yes, No, or a range of a number/amount (either end may be open). */
  match: { kind: 'option'; optionId: string } | { kind: 'yes' } | { kind: 'no' } | { kind: 'range'; min: number | null; max: number | null };
  minSeats: number | null; maxSeats: number | null;
}
export type TieStep = { kind: 'criterion'; criterionId: string } | { kind: 'manual' };
export interface Budget { total: number; per: 'fixed' | 'asked'; fixedAmount: number | null; fieldId: string | null }
export interface SelectionRules {
  /** The minimum of the final score, in the unit the call shows it (points, the scale or %). Null: none. */
  minTotal: number | null;
  /** A minimum for one criterion (the average of the evaluators). */
  minPerCriterion: { criterionId: string; min: number }[];
  /** How many projects are selected. Null: no limit of places. */
  slots: number | null;
  budget: Budget | null;
  /** How many go to the waiting list after the selected ones. */
  waitlist: number;
  quotas: Quota[];
  tieBreak: TieStep[];
}
export const DEFAULT_RULES: SelectionRules = { minTotal: null, minPerCriterion: [], slots: null, budget: null, waitlist: 5, quotas: [], tieBreak: [{ kind: 'manual' }] };

export const SELECTABLE_KINDS = ['single_choice', 'multiple_choice', 'yes_no', 'number'] as const;

export interface Candidate {
  applicationId: string; reference: string | null; startupName: string | null;
  /** The final score as a position on 0–100 (what the board ranks by); null while the evaluation is incomplete. */
  position: number | null;
  /** The average of the evaluators, per criterion (on the criterion's own scale). */
  perCriterion: Record<string, number>;
  answers: Record<string, AnswerValue>;
}
export interface Item {
  applicationId: string; rank: number | null; outcome: Outcome; explanation: string;
  /** The quotas this project counts in (it matches their category). */
  quotaIds: string[]; amount: number | null;
  /** Tied with someone it cannot be told apart from, and it matters (one place or the next): someone must decide. */
  tie: boolean;
  /** Left out for the budget although better placed than someone who was taken. */
  budgetSkipped: boolean;
}
export interface QuotaOutcome { quotaId: string; label: string; selected: number; minSeats: number | null; maxSeats: number | null; met: boolean }
export interface Proposal {
  items: Item[];
  summary: { selected: number; waitlist: number; rejected: number; notConsidered: number; budgetUsed: number | null; budgetLeft: number | null; places: number | null; quotas: QuotaOutcome[]; ties: string[]; skipped: string[] };
}

const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;
export const ordinal = (n: number): string => { const v = n % 100; return `${n}${v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`; };

// --- Units -----------------------------------------------------------------------------------------------------------------------------------------------------

/** A minimum typed in the unit of the call (points, the scale, %) as the position on 0–100 that the ranking uses. */
export function unitToPosition(value: number, criteria: Pick<Criterion, 'scaleMin' | 'scaleMax'>[], scoring: Scoring): number {
  if (scoring.mode === 'equal' && criteria.length > 0) {
    if (scoring.aggregation === 'sum') {
      const min = criteria.reduce((n, c) => n + c.scaleMin, 0); const max = criteria.reduce((n, c) => n + c.scaleMax, 0);
      return max > min ? round(((value - min) / (max - min)) * 100) : 0;
    }
    const first = criteria[0];
    if (criteria.every((c) => c.scaleMin === first.scaleMin && c.scaleMax === first.scaleMax)) return first.scaleMax > first.scaleMin ? round(((value - first.scaleMin) / (first.scaleMax - first.scaleMin)) * 100) : 0;
  }
  return value;
}
/** What the minimum is called on the screen, in the unit of the call: "60 %", "18 / 30 points", "3.5 / 5". */
export const minTotalText = (value: number, criteria: Pick<Criterion, 'scaleMin' | 'scaleMax'>[], scoring: Scoring): string => scoreText(unitToPosition(value, criteria, scoring), criteria, scoring);
/** The unit the minimum is typed in, for the label of the field. */
export function minTotalUnit(criteria: Pick<Criterion, 'scaleMin' | 'scaleMax'>[], scoring: Scoring): { unit: 'percent' | 'points' | 'scale'; max: number } {
  if (scoring.mode === 'equal' && criteria.length > 0) {
    if (scoring.aggregation === 'sum') return { unit: 'points', max: criteria.reduce((n, c) => n + c.scaleMax, 0) };
    const first = criteria[0];
    if (criteria.every((c) => c.scaleMin === first.scaleMin && c.scaleMax === first.scaleMax)) return { unit: 'scale', max: first.scaleMax };
  }
  return { unit: 'percent', max: 100 };
}

// --- Reading what the editor sends -----------------------------------------------------------------------------------------------------------------------------

const num = (v: unknown): number | null => { if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const posInt = (v: unknown, max = 100000): number | null => { const n = num(v); return n === null || n < 0 ? null : Math.min(max, Math.floor(n)); };
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export type ParsedRules = { ok: true; rules: SelectionRules } | { ok: false; error: string };

/** The rules as the editor sends them, checked against the form and the grid: unknown questions and criteria are refused, numbers are brought into range, nothing is guessed. */
export function parseRules(raw: unknown, ctx: { fields: Pick<FormField, 'id' | 'kind' | 'options' | 'label'>[]; criteria: Pick<Criterion, 'id'>[] }): ParsedRules {
  if (raw === null || raw === undefined || typeof raw !== 'object') return { ok: false, error: 'The rules are missing.' };
  const r = raw as Record<string, unknown>;
  const critIds = new Set(ctx.criteria.map((c) => c.id));
  const minTotal = num(r.minTotal);
  if (minTotal !== null && minTotal < 0) return { ok: false, error: 'The minimum score cannot be negative.' };
  const minPerCriterion: SelectionRules['minPerCriterion'] = [];
  for (const m of Array.isArray(r.minPerCriterion) ? r.minPerCriterion : []) {
    const id = str((m as Record<string, unknown>)?.criterionId, 80); const min = num((m as Record<string, unknown>)?.min);
    if (!critIds.has(id)) return { ok: false, error: 'A minimum points at a criterion that is not in the grid.' };
    if (min === null || min < 0) return { ok: false, error: 'A minimum per criterion needs a number.' };
    if (!minPerCriterion.some((x) => x.criterionId === id)) minPerCriterion.push({ criterionId: id, min });
  }
  const slots = posInt(r.slots);
  if (r.slots !== null && r.slots !== undefined && r.slots !== '' && slots === null) return { ok: false, error: 'The number of places must be a whole number.' };
  let budget: Budget | null = null;
  if (r.budget && typeof r.budget === 'object') {
    const b = r.budget as Record<string, unknown>;
    const total = num(b.total);
    if (total === null || total <= 0) return { ok: false, error: 'The total budget must be a positive amount.' };
    const per = b.per === 'asked' ? 'asked' : 'fixed';
    if (per === 'fixed') {
      const fixed = num(b.fixedAmount);
      if (fixed === null || fixed <= 0) return { ok: false, error: 'The amount per project must be a positive amount.' };
      budget = { total, per, fixedAmount: fixed, fieldId: null };
    } else {
      const fieldId = str(b.fieldId, 80); const f = ctx.fields.find((x) => x.id === fieldId);
      if (!f || f.kind !== 'number') return { ok: false, error: 'Choose the amount question of the form that holds the amount each project asks for.' };
      budget = { total, per, fixedAmount: null, fieldId };
    }
  }
  const waitlist = r.waitlist === undefined || r.waitlist === null || r.waitlist === '' ? DEFAULT_RULES.waitlist : posInt(r.waitlist, 1000);
  if (waitlist === null) return { ok: false, error: 'The size of the waiting list must be a whole number.' };
  const quotas: Quota[] = [];
  for (const q of Array.isArray(r.quotas) ? r.quotas : []) {
    const o = q as Record<string, unknown>; const fieldId = str(o.fieldId, 80); const f = ctx.fields.find((x) => x.id === fieldId);
    if (!f || !(SELECTABLE_KINDS as readonly string[]).includes(f.kind)) return { ok: false, error: 'A quota needs a closed question of the form: a choice, Yes/No, or a number.' };
    const m = (o.match ?? {}) as Record<string, unknown>;
    let match: Quota['match'];
    if (f.kind === 'yes_no') match = m.kind === 'no' ? { kind: 'no' } : { kind: 'yes' };
    else if (f.kind === 'number') {
      const lo = num(m.min); const hi = num(m.max);
      if (lo === null && hi === null) return { ok: false, error: 'A quota on a number needs a range: from, to, or both.' };
      if (lo !== null && hi !== null && lo > hi) return { ok: false, error: 'The range of a quota starts after it ends.' };
      match = { kind: 'range', min: lo, max: hi };
    } else {
      const optionId = str(m.optionId, 80);
      if (!f.options.some((x) => x.id === optionId)) return { ok: false, error: 'A quota points at an answer that is not an option of that question.' };
      match = { kind: 'option', optionId };
    }
    const minSeats = posInt(o.minSeats); const maxSeats = posInt(o.maxSeats);
    if (minSeats === null && maxSeats === null) return { ok: false, error: 'A quota needs a minimum, a maximum, or both.' };
    const named = match.kind === 'option' ? f.options.find((x) => x.id === (match as { optionId: string }).optionId)?.label : match.kind === 'yes' ? `${f.label.slice(0, 50)}: Yes` : match.kind === 'no' ? `${f.label.slice(0, 50)}: No` : `${f.label.slice(0, 50)} (range)`;
    quotas.push({ id: str(o.id, 40) || `q${quotas.length + 1}`, fieldId, label: str(o.label, 120) || (named ?? f.label).slice(0, 60), match, minSeats, maxSeats });
  }
  if (new Set(quotas.map((q) => q.id)).size !== quotas.length) return { ok: false, error: 'Two quotas have the same id.' };
  const tieBreak: TieStep[] = [];
  for (const t of Array.isArray(r.tieBreak) ? r.tieBreak : []) {
    const o = t as Record<string, unknown>;
    if (o.kind === 'manual') { if (!tieBreak.some((x) => x.kind === 'manual')) tieBreak.push({ kind: 'manual' }); continue; }
    const id = str(o.criterionId, 80);
    if (!critIds.has(id)) return { ok: false, error: 'A tie-break points at a criterion that is not in the grid.' };
    if (!tieBreak.some((x) => x.kind === 'criterion' && x.criterionId === id)) tieBreak.push({ kind: 'criterion', criterionId: id });
  }
  return { ok: true, rules: { minTotal, minPerCriterion, slots, budget, waitlist, quotas, tieBreak } };
}

// --- What cannot work, said at once ---------------------------------------------------------------------------------------------------------------------------

/** Impossible or contradictory rules, in a sentence each (the screen shows them as soon as they are written; the proposal is still calculated). */
export function ruleWarnings(rules: SelectionRules, criteria: Pick<Criterion, 'id' | 'name' | 'scaleMin' | 'scaleMax'>[], scoring: Scoring): string[] {
  const out: string[] = [];
  const mins = rules.quotas.reduce((n, q) => n + (q.minSeats ?? 0), 0);
  if (rules.slots !== null && mins > rules.slots) out.push(`The minimum places of the quotas add up to ${mins}, more than the ${rules.slots} places.`);
  for (const q of rules.quotas) if (q.minSeats !== null && q.maxSeats !== null && q.minSeats > q.maxSeats) out.push(`Quota “${q.label}”: the minimum (${q.minSeats}) is above its maximum (${q.maxSeats}).`);
  if (rules.budget) {
    if (rules.budget.per === 'fixed' && rules.budget.fixedAmount !== null) {
      const fits = Math.floor(rules.budget.total / rules.budget.fixedAmount);
      if (fits === 0) out.push('The amount per project is more than the whole budget: no project can be selected.');
      else if (rules.slots !== null && fits < rules.slots) out.push(`The budget pays for ${fits} project${fits === 1 ? '' : 's'}, fewer than the ${rules.slots} places: the budget will be the first limit.`);
    }
  }
  if (rules.minTotal !== null) {
    const { max } = minTotalUnit(criteria, scoring);
    if (rules.minTotal > max) out.push(`The minimum score (${rules.minTotal}) is above the maximum possible (${max}): nobody can pass it.`);
  }
  for (const m of rules.minPerCriterion) {
    const c = criteria.find((x) => x.id === m.criterionId);
    if (c && m.min > c.scaleMax) out.push(`The minimum for “${c.name}” (${m.min}) is above its maximum score (${c.scaleMax}): nobody can pass it.`);
  }
  return out;
}

// --- The proposal ------------------------------------------------------------------------------------------------------------------------------------------------

export function matchesQuota(q: Quota, answers: Record<string, AnswerValue>): boolean {
  const a = answers[q.fieldId] as unknown;
  if (a === undefined || a === null || a === '') return false;
  switch (q.match.kind) {
    case 'option': return Array.isArray(a) ? (a as unknown[]).includes(q.match.optionId) : a === q.match.optionId;
    case 'yes': return a === 'yes';
    case 'no': return a === 'no';
    case 'range': { const n = Number(a); return Number.isFinite(n) && (q.match.min === null || n >= q.match.min) && (q.match.max === null || n <= q.match.max); }
  }
}

export interface ProposeInput {
  rules: SelectionRules; criteria: Criterion[]; scoring: Scoring; candidates: Candidate[];
  /** The people's own order for candidates the chain cannot tell apart (first = best). */
  manualOrder?: string[];
}

export function propose(input: ProposeInput): Proposal {
  const { rules, criteria, scoring, candidates } = input;
  const manual = new Map((input.manualOrder ?? []).map((id, i) => [id, i]));
  const critName = (id: string) => criteria.find((c) => c.id === id)?.name ?? 'a criterion';
  const items = new Map<string, Item>();
  const set = (c: Candidate, patch: Partial<Item>) => items.set(c.applicationId, { applicationId: c.applicationId, rank: null, outcome: 'not_considered', explanation: '', quotaIds: [], amount: null, tie: false, budgetSkipped: false, ...(items.get(c.applicationId) ?? {}), ...patch });

  // 1. who takes part
  const evaluated = candidates.filter((c) => c.position !== null);
  for (const c of candidates.filter((x) => x.position === null)) set(c, { explanation: 'Not considered: the evaluation is not complete.' });

  // 2. the minimums
  const minPos = rules.minTotal === null ? null : unitToPosition(rules.minTotal, criteria, scoring);
  const perMins = [...rules.minPerCriterion];
  for (const c of criteria) if (c.minScore !== null && c.minScore !== undefined && !perMins.some((m) => m.criterionId === c.id)) perMins.push({ criterionId: c.id, min: c.minScore });   // the eliminatory minimum of the grid
  const failing = new Map<string, string>();
  for (const c of evaluated) {
    if (minPos !== null && (c.position as number) < minPos) { failing.set(c.applicationId, `Rejected: below the minimum score (${scoreText(c.position, criteria, scoring)} < ${minTotalText(rules.minTotal as number, criteria, scoring)})`); continue; }
    for (const m of perMins) {
      const avg = c.perCriterion[m.criterionId];
      if (typeof avg === 'number' && avg < m.min) { failing.set(c.applicationId, `Rejected: below the ${critName(m.criterionId)} minimum (${round(avg, 2)} < ${m.min})`); break; }
    }
  }
  for (const c of evaluated) if (failing.has(c.applicationId)) set(c, { outcome: 'reject', explanation: `${failing.get(c.applicationId)}.` });

  // 3. the order
  const cmp = (a: Candidate, b: Candidate): number => {
    if ((b.position as number) !== (a.position as number)) return (b.position as number) - (a.position as number);
    for (const t of rules.tieBreak) {
      if (t.kind === 'criterion') { const d = (b.perCriterion[t.criterionId] ?? -Infinity) - (a.perCriterion[t.criterionId] ?? -Infinity); if (d !== 0 && Number.isFinite(d)) return d; }
      else { const ia = manual.get(a.applicationId); const ib = manual.get(b.applicationId); if (ia !== undefined && ib !== undefined && ia !== ib) return ia - ib; }
    }
    return 0;
  };
  const sorted = evaluated.filter((c) => !failing.has(c.applicationId)).sort((a, b) => cmp(a, b) || a.applicationId.localeCompare(b.applicationId));
  const rankOf = new Map(sorted.map((c, i) => [c.applicationId, i + 1]));
  const quotasOf = (c: Candidate) => rules.quotas.filter((q) => matchesQuota(q, c.answers));
  const amountOf = (c: Candidate): number | null => {
    if (!rules.budget) return null;
    if (rules.budget.per === 'fixed') return rules.budget.fixedAmount;
    const n = Number(c.answers[rules.budget.fieldId as string] as unknown);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  // 4. and 5. the places
  const places = rules.slots;
  const noLimit = places === null && !rules.budget;
  let budgetLeft = rules.budget ? rules.budget.total : Infinity;
  const taken = new Set<string>(); const viaQuota = new Map<string, string>();
  const countIn = (q: Quota) => sorted.filter((c) => taken.has(c.applicationId) && matchesQuota(q, c.answers)).length;
  const blocked = new Map<string, string>();
  const why = (c: Candidate): string | null => {
    if (places !== null && taken.size >= places) return 'slots full';
    for (const q of quotasOf(c)) if (q.maxSeats !== null && countIn(q) >= q.maxSeats) return `${q.label} quota full`;
    if (rules.budget) {
      const amt = amountOf(c);
      if (amt === null) return 'no amount asked';
      if (amt > budgetLeft) return `budget reached (needs ${amt}, ${round(budgetLeft, 2)} left)`;
    }
    return null;
  };
  const take = (c: Candidate, quota?: Quota) => { taken.add(c.applicationId); if (rules.budget) budgetLeft -= amountOf(c) ?? 0; if (quota) viaQuota.set(c.applicationId, quota.label); };
  if (noLimit) for (const c of sorted) take(c);
  else {
    for (const q of rules.quotas) {
      if (!q.minSeats) continue;
      for (const c of sorted) { if (countIn(q) >= q.minSeats) break; if (!taken.has(c.applicationId) && matchesQuota(q, c.answers) && why(c) === null) take(c, q); }
    }
    for (const c of sorted) { if (taken.has(c.applicationId)) continue; const w = why(c); if (w === null) take(c); else blocked.set(c.applicationId, w); }
  }

  // 6. and 7. the waiting list, and the rest
  const rest = sorted.filter((c) => !taken.has(c.applicationId));
  const waiting = new Set(rest.slice(0, rules.waitlist).map((c) => c.applicationId));
  const lastTakenRank = Math.max(0, ...sorted.filter((c) => taken.has(c.applicationId)).map((c) => rankOf.get(c.applicationId) as number));
  for (const c of sorted) {
    const rank = rankOf.get(c.applicationId) as number; const quotaIds = quotasOf(c).map((q) => q.id); const amount = taken.has(c.applicationId) ? amountOf(c) : null;
    if (taken.has(c.applicationId)) set(c, { rank, outcome: 'selected', quotaIds, amount, explanation: `Selected: ${ordinal(rank)} place${viaQuota.has(c.applicationId) ? `, ${viaQuota.get(c.applicationId)} quota` : ''}.` });
    else {
      const reason = blocked.get(c.applicationId) ?? 'not within the available places';
      const skipped = rank < lastTakenRank && /^budget reached|^no amount/.test(reason);
      if (waiting.has(c.applicationId)) set(c, { rank, outcome: 'waitlist', quotaIds, budgetSkipped: skipped, explanation: `Waitlist: ${ordinal(rank)} place, ${reason}${skipped ? '; a lower-ranked project that fits the budget was selected instead' : ''}.` });
      else set(c, { rank, outcome: 'reject', quotaIds, budgetSkipped: skipped, explanation: `Rejected: ${ordinal(rank)} place, ${reason === 'slots full' ? 'not within the available places' : reason}${skipped ? '; a lower-ranked project that fits the budget was selected instead' : ''}.` });
    }
  }

  // the ties that matter: neighbours that cannot be told apart and do not end up in the same place
  const ties: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && cmp(sorted[i], sorted[j]) === 0) j++;
    if (j - i > 1) {
      const group = sorted.slice(i, j); const outs = new Set(group.map((c) => items.get(c.applicationId)!.outcome));
      if (outs.size > 1) for (const c of group) { ties.push(c.applicationId); set(c, { tie: true, explanation: `Tie — decide: ${ordinal(rankOf.get(c.applicationId) as number)} place, tied with ${group.length - 1} other${group.length === 2 ? '' : 's'} on every criterion of the tie-break; ${items.get(c.applicationId)!.explanation}` }); }
    }
    i = j;
  }

  const list = candidates.map((c) => items.get(c.applicationId) ?? { applicationId: c.applicationId, rank: null, outcome: 'not_considered' as Outcome, explanation: 'Not considered.', quotaIds: [], amount: null, tie: false, budgetSkipped: false });
  const count = (o: Outcome) => list.filter((i) => i.outcome === o).length;
  const sel = list.filter((i) => i.outcome === 'selected');
  return {
    items: list,
    summary: {
      selected: count('selected'), waitlist: count('waitlist'), rejected: count('reject'), notConsidered: count('not_considered'),
      budgetUsed: rules.budget ? round(sel.reduce((n, i) => n + (i.amount ?? 0), 0), 2) : null, budgetLeft: rules.budget ? round(rules.budget.total - sel.reduce((n, i) => n + (i.amount ?? 0), 0), 2) : null,
      places, ties, skipped: list.filter((i) => i.budgetSkipped).map((i) => i.applicationId),
      quotas: rules.quotas.map((q) => { const n = sel.filter((i) => i.quotaIds.includes(q.id)).length; return { quotaId: q.id, label: q.label, selected: n, minSeats: q.minSeats, maxSeats: q.maxSeats, met: (q.minSeats === null || n >= q.minSeats) && (q.maxSeats === null || n <= q.maxSeats) }; }),
    },
  };
}

/** A few invented applications, to see what the rules do while they are being written (nothing here is real data). */
export function sampleCandidates(rules: SelectionRules, criteria: Criterion[], fields: Pick<FormField, 'id' | 'kind' | 'options'>[]): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < 12; i++) {
    const position = round(92 - i * 5.5);
    const answers: Record<string, AnswerValue> = {};
    for (const q of rules.quotas) {
      const f = fields.find((x) => x.id === q.fieldId);
      if (!f) continue;
      if (q.match.kind === 'option') answers[q.fieldId] = i % 3 === 0 ? q.match.optionId : (f.options.find((o) => o.id !== (q.match as { optionId: string }).optionId)?.id ?? q.match.optionId);
      else if (q.match.kind === 'yes' || q.match.kind === 'no') answers[q.fieldId] = (i % 2 === 0) === (q.match.kind === 'yes') ? 'yes' : 'no';
      else answers[q.fieldId] = String(Math.round(((q.match.min ?? 0) + (q.match.max ?? (q.match.min ?? 0) * 2 + 100)) / 2) + (i % 2 === 0 ? 0 : 1000000));
    }
    if (rules.budget?.per === 'asked' && rules.budget.fieldId) answers[rules.budget.fieldId] = String(100000 + (i % 4) * 50000);
    out.push({ applicationId: `sample-${i + 1}`, reference: `EX-${String(i + 1).padStart(3, '0')}`, startupName: `Example startup ${i + 1}`, position, perCriterion: Object.fromEntries(criteria.map((c, k) => [c.id, round(c.scaleMin + ((c.scaleMax - c.scaleMin) * Math.max(0, position - (k % 2) * 8)) / 100)])), answers });
  }
  return out;
}
