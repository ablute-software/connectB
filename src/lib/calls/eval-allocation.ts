// Prompt 922 (Adenda 1, C) — HOW the load of the evaluation is shared, pure. The entity chooses (Nuno, 29/10/2026):
//   • Equal      every evaluator gets the same share (what the platform always did): each application takes the evaluators with the least work;
//   • Weighted   each evaluator has a percentage of the load (30 / 50 / 20, adding up to 100 %) — or, instead, a maximum number of applications; the number of evaluators per application and the conflicts of
//                interest still hold;
//   • By rules   the answers route an application to a PANEL of evaluators ("Sector is Health → Health panel"): named groups, a person may be in several; rules in order, each with one or more conditions on a
//                closed question (all of them must hold); an application that meets several rules goes to the first one's panel (default) or to all of them; one that meets none follows the fallback (everyone,
//                equally or by percentage) or stays "Unassigned" for a person to assign. Inside a panel the load is equal or by percentage, and N evaluators per application is counted INSIDE the panel: a panel
//                smaller than N says so, and the entity chooses between completing with people from outside or lowering N for that panel.
// What the pure functions here decide is only WHO would get WHAT; the preview shows it, "Apply" does it, and a started or submitted evaluation is never moved. The conflicts of interest are an input (a pair that is
// blocked is never chosen), exactly as for the equal distribution.
import type { FormField } from './types';

export const STRATEGIES = ['equal', 'weighted', 'rules'] as const;
export type Strategy = (typeof STRATEGIES)[number];
export const MAX_PANELS = 20;
export const MAX_RULES = 50;
export const MAX_CONDITIONS = 8;
export const MAX_PANEL_NAME = 60;

export interface Share {
  /** 'percent': each evaluator has a share of the load, adding up to 100 %. 'max': each has a maximum number of applications (instead). */
  by: 'percent' | 'max';
  percent: Record<string, number | null>;
  max: Record<string, number | null>;
}
export interface Panel {
  id: string; name: string; members: string[];
  /** Inside the panel: equal load, or a percentage each (adding up to 100 %). */
  balance: 'equal' | 'percent'; percent: Record<string, number | null>;
  /** What to do when the panel has fewer evaluators than N: complete with people from outside, or lower N for this panel. null = the entity has not chosen yet (and cannot apply until it does). */
  shortfall: 'complete' | 'lower' | null;
}
export type Condition =
  | { fieldId: string; type: 'choice'; optionIds: string[] }
  | { fieldId: string; type: 'yes_no'; yes: boolean }
  | { fieldId: string; type: 'range'; min: number | null; max: number | null };
export interface Rule { id: string; panelId: string; conditions: Condition[] }
export interface AllocConfig {
  strategy: Strategy;
  weighted: Share;
  panels: Panel[];
  rules: Rule[];
  /** An application that meets several rules: the first one's panel, or all the panels. */
  multi: 'first' | 'all';
  /** An application that meets no rule: every evaluator equally, every evaluator by the weighted shares, or nobody (to be assigned by hand). */
  fallback: 'equal' | 'weighted' | 'unassigned';
}
export const DEFAULT_ALLOC: AllocConfig = { strategy: 'equal', weighted: { by: 'percent', percent: {}, max: {} }, panels: [], rules: [], multi: 'first', fallback: 'equal' };
export const freshAlloc = (): AllocConfig => ({ ...DEFAULT_ALLOC, weighted: { by: 'percent', percent: {}, max: {} }, panels: [], rules: [] });

type FieldLite = Pick<FormField, 'id' | 'kind' | 'options'> & Partial<Pick<FormField, 'label'>>;
export const RULE_KINDS: readonly string[] = ['single_choice', 'multiple_choice', 'yes_no', 'number'];
export const isRuleField = (f: Pick<FormField, 'kind'>): boolean => RULE_KINDS.includes(f.kind);

const round = (n: number, d = 3): number => Math.round(n * 10 ** d) / 10 ** d;

// --- Reading what the editor sent --------------------------------------------------------------------------------------------------------------

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const num = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? round(v) : null);
const nums = (raw: unknown, min: number, max: number, integer: boolean): Record<string, number | null> | null => {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ID.test(k)) return null;
    if (v === null || v === '') { out[k] = null; continue; }
    const n = num(v, min, max);
    if (n === null || (integer && !Number.isInteger(n))) return null;
    out[k] = n;
  }
  return out;
};

export type ParsedAlloc = { ok: true; config: AllocConfig } | { ok: false; error: string };

/** The configuration as the editor sent it, read strictly but NOT demanded complete (it is saved while it is built; `allocProblems` says what stops it from being applied). */
export function parseAlloc(raw: unknown): ParsedAlloc {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!r) return { ok: false, error: 'The distribution settings are not valid.' };
  const strategy = (STRATEGIES as readonly string[]).includes(String(r.strategy)) ? (r.strategy as Strategy) : null;
  if (!strategy) return { ok: false, error: 'Choose Equal, Weighted or By rules.' };
  const w = (r.weighted && typeof r.weighted === 'object' ? r.weighted : {}) as Record<string, unknown>;
  const wp = nums(w.percent, 0, 100, false); const wm = nums(w.max, 0, 100000, true);
  if (!wp || !wm) return { ok: false, error: 'The percentages are numbers from 0 to 100 and the maximums whole numbers.' };
  const weighted: Share = { by: w.by === 'max' ? 'max' : 'percent', percent: wp, max: wm };
  const panelsRaw = Array.isArray(r.panels) ? (r.panels as Record<string, unknown>[]) : [];
  if (panelsRaw.length > MAX_PANELS) return { ok: false, error: `At most ${MAX_PANELS} panels.` };
  const panels: Panel[] = [];
  for (const p of panelsRaw) {
    const id = typeof p?.id === 'string' && ID.test(p.id) ? p.id : null;
    if (!id || panels.some((x) => x.id === id)) return { ok: false, error: 'A panel is not valid.' };
    const name = typeof p.name === 'string' ? p.name.replace(/\s+/g, ' ').trim().slice(0, MAX_PANEL_NAME) : '';
    const members = Array.isArray(p.members) ? [...new Set((p.members as unknown[]).filter((m): m is string => typeof m === 'string' && ID.test(m)))] : [];
    const pp = nums(p.percent, 0, 100, false);
    if (!pp) return { ok: false, error: `Panel “${name || 'unnamed'}”: the percentages are numbers from 0 to 100.` };
    panels.push({ id, name, members, balance: p.balance === 'percent' ? 'percent' : 'equal', percent: pp, shortfall: p.shortfall === 'complete' || p.shortfall === 'lower' ? p.shortfall : null });
  }
  const rulesRaw = Array.isArray(r.rules) ? (r.rules as Record<string, unknown>[]) : [];
  if (rulesRaw.length > MAX_RULES) return { ok: false, error: `At most ${MAX_RULES} rules.` };
  const rules: Rule[] = [];
  for (const x of rulesRaw) {
    const id = typeof x?.id === 'string' && ID.test(x.id) ? x.id : null;
    if (!id || rules.some((y) => y.id === id)) return { ok: false, error: 'A rule is not valid.' };
    const conds = Array.isArray(x.conditions) ? (x.conditions as Record<string, unknown>[]) : [];
    if (conds.length > MAX_CONDITIONS) return { ok: false, error: `At most ${MAX_CONDITIONS} conditions in a rule.` };
    const conditions: Condition[] = [];
    for (const c of conds) {
      const fieldId = typeof c?.fieldId === 'string' && ID.test(c.fieldId) ? c.fieldId : null;
      if (!fieldId) return { ok: false, error: 'A condition needs a question.' };
      if (c.type === 'choice') conditions.push({ fieldId, type: 'choice', optionIds: Array.isArray(c.optionIds) ? [...new Set((c.optionIds as unknown[]).filter((o): o is string => typeof o === 'string' && o.length > 0 && o.length <= 80))] : [] });
      else if (c.type === 'yes_no') conditions.push({ fieldId, type: 'yes_no', yes: c.yes !== false });
      else if (c.type === 'range') {
        const min = c.min === null || c.min === undefined || c.min === '' ? null : typeof c.min === 'number' && Number.isFinite(c.min) ? c.min : undefined;
        const max = c.max === null || c.max === undefined || c.max === '' ? null : typeof c.max === 'number' && Number.isFinite(c.max) ? c.max : undefined;
        if (min === undefined || max === undefined) return { ok: false, error: 'The limits of a range are numbers.' };
        conditions.push({ fieldId, type: 'range', min, max });
      } else return { ok: false, error: 'A condition is not valid.' };
    }
    rules.push({ id, panelId: typeof x.panelId === 'string' ? x.panelId : '', conditions });
  }
  return { ok: true, config: { strategy, weighted, panels, rules, multi: r.multi === 'all' ? 'all' : 'first', fallback: r.fallback === 'weighted' || r.fallback === 'unassigned' ? r.fallback : 'equal' } };
}

// --- What is missing -------------------------------------------------------------------------------------------------------------------------------

export interface AllocContext { evaluators: { userId: string; name: string | null }[]; fields: FieldLite[]; n: number | 'all' }
const sumOf = (rec: Record<string, number | null>, users: string[]): number => round(users.reduce((n, u) => n + (rec[u] ?? 0), 0));

/** What stops the configuration from being applied, in words. Only what concerns the chosen strategy. */
export function allocProblems(c: AllocConfig, ctx: AllocContext): string[] {
  const out: string[] = [];
  const ids = ctx.evaluators.map((e) => e.userId);
  const nameOf = (u: string) => ctx.evaluators.find((e) => e.userId === u)?.name ?? 'An evaluator';
  const share = (s: Share, label: string, users: string[]) => {
    if (users.length === 0) { out.push(`${label}: nobody can evaluate yet.`); return; }
    if (s.by === 'percent') {
      const sum = sumOf(s.percent, users);
      if (Math.abs(sum - 100) > 0.001) out.push(`${label}: the percentages add up to ${sum} %, not 100 % (${sum < 100 ? `${round(100 - sum)} % missing` : `${round(sum - 100)} % over`}).`);
    } else {
      const missing = users.filter((u) => s.max[u] === null || s.max[u] === undefined);
      for (const u of missing) out.push(`${label}: give ${nameOf(u)} a maximum number of applications.`);
    }
  };
  if (c.strategy === 'weighted') share(c.weighted, 'Weighted', ids);
  if (c.strategy === 'rules') {
    if (c.panels.length === 0) out.push('Create at least one panel of evaluators.');
    const names = new Set<string>();
    for (const p of c.panels) {
      const label = `Panel “${p.name || 'unnamed'}”`;
      if (!p.name) out.push('Give every panel a name.');
      else if (names.has(p.name.toLowerCase())) out.push(`${label}: two panels have the same name.`);
      names.add(p.name.toLowerCase());
      const live = p.members.filter((m) => ids.includes(m));
      if (p.members.length === 0) out.push(`${label} has no evaluators.`);
      else if (live.length < p.members.length) out.push(`${label} has ${p.members.length - live.length} person${p.members.length - live.length === 1 ? '' : 's'} who can no longer evaluate: take them out.`);
      if (p.balance === 'percent' && live.length > 0) { const sum = sumOf(p.percent, live); if (Math.abs(sum - 100) > 0.001) out.push(`${label}: the percentages add up to ${sum} %, not 100 %.`); }
      const n = ctx.n === 'all' ? live.length : ctx.n;
      if (live.length > 0 && live.length < n && p.shortfall === null) out.push(`${label} has ${live.length} evaluator${live.length === 1 ? '' : 's'} but each application needs ${n}: choose to complete with other evaluators or to lower the number for this panel.`);
    }
    if (c.rules.length === 0) out.push('Add at least one rule.');
    c.rules.forEach((r, i) => {
      const label = `Rule ${i + 1}`;
      if (!c.panels.some((p) => p.id === r.panelId)) out.push(`${label}: choose the panel it sends the application to.`);
      if (r.conditions.length === 0) out.push(`${label}: add a condition.`);
      for (const cond of r.conditions) {
        const f = ctx.fields.find((x) => x.id === cond.fieldId);
        if (!f) { out.push(`${label}: a condition is about a question that is not in the form any more.`); continue; }
        if (!isRuleField(f)) { out.push(`${label}: “${f.label ?? 'a question'}” cannot be used in a rule (single choice, multiple choice, Yes/No, number or amount can).`); continue; }
        if (cond.type === 'choice') {
          if (f.kind !== 'single_choice' && f.kind !== 'multiple_choice') out.push(`${label}: “${f.label ?? 'a question'}” is not a choice question.`);
          else if (cond.optionIds.length === 0) out.push(`${label}: choose at least one answer of “${f.label ?? 'the question'}”.`);
          else if (cond.optionIds.some((o) => !f.options.some((x) => x.id === o))) out.push(`${label}: an answer chosen is no longer an option of “${f.label ?? 'the question'}”.`);
        } else if (cond.type === 'yes_no') { if (f.kind !== 'yes_no') out.push(`${label}: “${f.label ?? 'a question'}” is not a Yes/No question.`); }
        else if (f.kind !== 'number') out.push(`${label}: “${f.label ?? 'a question'}” is not a number.`);
        else if (cond.min === null && cond.max === null) out.push(`${label}: give the range of “${f.label ?? 'the question'}” a minimum or a maximum.`);
        else if (cond.min !== null && cond.max !== null && cond.min > cond.max) out.push(`${label}: the minimum is above the maximum.`);
      }
    });
    if (c.fallback === 'weighted') share(c.weighted, 'Applications that meet no rule (Weighted)', ids);
  }
  return out;
}

// --- Matching an application to the rules -----------------------------------------------------------------------------------------------------

/** Whether one condition holds for the answers. A question that was not answered (or not shown) never matches. */
export function conditionHolds(cond: Condition, field: FieldLite | undefined, answer: unknown): boolean {
  if (!field) return false;
  if (cond.type === 'choice') {
    if (field.kind === 'single_choice') return typeof answer === 'string' && cond.optionIds.includes(answer);
    if (field.kind === 'multiple_choice') return Array.isArray(answer) && (answer as unknown[]).some((a) => typeof a === 'string' && cond.optionIds.includes(a));
    return false;
  }
  if (cond.type === 'yes_no') return field.kind === 'yes_no' && (answer === 'yes' || answer === 'no') && (answer === 'yes') === cond.yes;
  if (field.kind !== 'number' || typeof answer !== 'string' || answer.trim() === '') return false;
  const v = Number(answer.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(v)) return false;
  return (cond.min === null || v >= cond.min) && (cond.max === null || v <= cond.max);
}

/** The rules an application meets (all conditions of a rule must hold), in the order of the rules. */
export function matchedRules(c: Pick<AllocConfig, 'rules'>, fields: FieldLite[], answers: Record<string, unknown>): Rule[] {
  return c.rules.filter((r) => r.conditions.length > 0 && r.conditions.every((cond) => conditionHolds(cond, fields.find((f) => f.id === cond.fieldId), answers[cond.fieldId])));
}
/** The panels an application goes to: the first matching rule's, or those of all matching rules. */
export function panelsFor(c: Pick<AllocConfig, 'rules' | 'multi'>, fields: FieldLite[], answers: Record<string, unknown>): string[] {
  const m = matchedRules(c, fields, answers);
  const ids = c.multi === 'all' ? m.map((r) => r.panelId) : m.slice(0, 1).map((r) => r.panelId);
  return [...new Set(ids)];
}

// --- The distribution --------------------------------------------------------------------------------------------------------------------------

export interface Pair { applicationId: string; userId: string }
const key = (a: string, u: string): string => `${a}:${u}`;

/** Splits `total` among the people in proportion to their weights, in whole numbers: everybody gets the floor and the largest fractions get the rest (ties by id). */
export function apportion(total: number, weights: Record<string, number>): Record<string, number> {
  const ids = Object.keys(weights).sort();
  const sum = ids.reduce((n, u) => n + weights[u], 0);
  const out: Record<string, number> = Object.fromEntries(ids.map((u) => [u, 0]));
  if (sum <= 0 || total <= 0) return out;
  const exact = ids.map((u) => ({ u, v: (weights[u] / sum) * total }));
  for (const e of exact) out[e.u] = Math.floor(e.v + 1e-9);
  let left = total - ids.reduce((n, u) => n + out[u], 0);
  for (const e of [...exact].sort((a, b) => (b.v - Math.floor(b.v + 1e-9)) - (a.v - Math.floor(a.v + 1e-9)) || (a.u < b.u ? -1 : 1))) { if (left <= 0) break; out[e.u]++; left--; }
  return out;
}

export interface AllocInput {
  config: AllocConfig;
  applications: { applicationId: string; answers: Record<string, unknown> }[];
  fields: FieldLite[];
  evaluators: string[];
  n: number | 'all';
  /** What is assigned now (conflicts already taken out). `fixed`: an evaluation was started, or it was assigned by hand — it stays whatever the rules say. */
  existing: (Pair & { fixed: boolean })[];
  blocked: Pair[];
  /** true: the assignments that are not fixed are decided again (a change of rules); false: only what is missing is filled in (a new application). */
  replan: boolean;
}
export interface AllocPanelView { panelId: string; name: string; applications: number; slots: number; size: number; needsChoice: boolean; short: boolean; evaluators: { userId: string; requested: number | null; got: number }[] }
export interface AllocOutput {
  add: Pair[]; remove: Pair[];
  shortfalls: { applicationId: string; wanted: number; got: number; reason: 'conflicts' | 'panel' | 'capacity' }[];
  /** Applications each evaluator ends up with (kept and new). */
  loads: Record<string, number>;
  /** Weighted: what each evaluator asked for and gets. */
  evaluators: { userId: string; requested: number | null; limit: number | null; got: number }[];
  panels: AllocPanelView[];
  /** Applications that meet no rule and are left for a person to assign. */
  unassigned: string[];
  /** The panels each application was sent to (by rule), for the screen. */
  matched: Record<string, string[]>;
  /** Names of the panels whose shortfall choice is still to be made: nothing can be applied until it is. */
  needsChoice: string[];
  warning: string | null;
}

interface Group { members: string[]; balance: 'equal' | 'percent' | 'max'; percent: Record<string, number>; max: Record<string, number> }

export function allocate(inp: AllocInput): AllocOutput {
  const evaluators = [...new Set(inp.evaluators)].sort();
  const evalSet = new Set(evaluators);
  const blocked = new Set(inp.blocked.map((p) => key(p.applicationId, p.userId)));
  const c = inp.config;
  // What each application holds before planning: everything (filling in) or only what is fixed (re-deciding).
  const hold = new Map<string, Set<string>>();
  const load: Record<string, number> = Object.fromEntries(evaluators.map((u) => [u, 0]));
  const keepNow = inp.existing.filter((p) => evalSet.has(p.userId) && (!inp.replan || p.fixed));
  for (const p of keepNow) { (hold.get(p.applicationId) ?? hold.set(p.applicationId, new Set()).get(p.applicationId)!).add(p.userId); load[p.userId]++; }
  const holds = (a: string): Set<string> => hold.get(a) ?? hold.set(a, new Set()).get(a)!;
  const add: Pair[] = [];
  const shortfalls: AllocOutput['shortfalls'] = [];
  const matched: Record<string, string[]> = {};
  const unassigned: string[] = [];
  const needsChoice: string[] = [];
  const panelViews: AllocPanelView[] = [];
  const placed = new Map<string, number>();                        // new assignments per evaluator, for the views

  // An evaluation already started, or an assignment made by hand, counts toward N wherever it sits: a change of rules never asks for one more person on top of someone who is already evaluating it.
  const fixedKeys = new Set(inp.existing.filter((p) => p.fixed).map((p) => key(p.applicationId, p.userId)));
  const need = (members: string[], app: string, wantAll: boolean): number => {
    const ok = members.filter((u) => !blocked.has(key(app, u)));
    const have = [...holds(app)].filter((u) => members.includes(u) || fixedKeys.has(key(app, u))).length;
    return Math.max(0, (wantAll ? ok.length : (inp.n === 'all' ? ok.length : inp.n)) - have);
  };

  /** Assigns `slots` = [application, how many] inside one group, in the order that leaves room for the applications with the fewest choices. */
  function runGroup(g: Group, slots: { applicationId: string; count: number }[], panelId?: string): void {
    const members = g.members.filter((u) => evalSet.has(u));
    const usable = (u: string) => (g.balance === 'percent' ? (g.percent[u] ?? 0) > 0 : g.balance === 'max' ? (g.max[u] ?? 0) > 0 : true);
    const pool = members.filter(usable);
    const total = slots.reduce((n, s) => n + s.count, 0);
    let target: Record<string, number> = {};
    if (g.balance === 'percent' && pool.length > 0) {
      const base = pool.reduce((n, u) => n + load[u], 0) + total;
      target = apportion(base, Object.fromEntries(pool.map((u) => [u, g.percent[u] ?? 0])));
    }
    const candidatesOf = (app: string) => pool.filter((u) => !holds(app).has(u) && !blocked.has(key(app, u)) && (g.balance !== 'max' || load[u] < (g.max[u] ?? 0)));
    const order = [...slots].sort((a, b) => candidatesOf(a.applicationId).length - candidatesOf(b.applicationId).length || slots.indexOf(a) - slots.indexOf(b));
    for (const s of order) {
      let got = 0;
      for (let k = 0; k < s.count; k++) {
        const cands = candidatesOf(s.applicationId);
        if (cands.length === 0) break;
        cands.sort((a, b) => (g.balance === 'percent' ? (target[b] - load[b]) - (target[a] - load[a]) : 0) || load[a] - load[b] || (a < b ? -1 : 1));
        const u = cands[0];
        holds(s.applicationId).add(u); load[u]++; add.push({ applicationId: s.applicationId, userId: u }); placed.set(u, (placed.get(u) ?? 0) + 1); got++;
      }
      if (got < s.count) shortfalls.push({ applicationId: s.applicationId, wanted: s.count, got, reason: g.balance === 'max' ? 'capacity' : panelId ? 'panel' : 'conflicts' });
    }
  }

  const everyone: Group = { members: evaluators, balance: 'equal', percent: {}, max: {} };
  const weightedGroup = (): Group => {
    const w = c.weighted;
    return { members: evaluators, balance: w.by === 'max' ? 'max' : 'percent', percent: Object.fromEntries(evaluators.map((u) => [u, w.percent[u] ?? 0])), max: Object.fromEntries(evaluators.map((u) => [u, w.max[u] ?? 0])) };
  };
  const wantedFor = (app: string, members: string[]) => (inp.n === 'all' ? members.filter((u) => !blocked.has(key(app, u))).length : inp.n);

  if (c.strategy === 'rules') {
    const byPanel = new Map<string, { applicationId: string }[]>();
    const fallbackApps: string[] = [];
    for (const a of inp.applications) {
      const ps = panelsFor(c, inp.fields, a.answers).filter((id) => c.panels.some((p) => p.id === id));
      matched[a.applicationId] = ps;
      if (ps.length === 0) { fallbackApps.push(a.applicationId); continue; }
      for (const id of ps) (byPanel.get(id) ?? byPanel.set(id, []).get(id)!).push({ applicationId: a.applicationId });
    }
    for (const p of c.panels) {
      const apps = byPanel.get(p.id) ?? [];
      const members = p.members.filter((u) => evalSet.has(u));
      const nWanted = inp.n === 'all' ? members.length : inp.n;
      const smaller = members.length > 0 && members.length < nWanted;
      const choice = p.shortfall ?? 'lower';
      if (smaller && p.shortfall === null && apps.length > 0) needsChoice.push(p.name || 'unnamed');
      const slots = apps.map((a) => ({ applicationId: a.applicationId, count: need(members, a.applicationId, false) })).filter((s) => s.count > 0);
      const g: Group = { members, balance: p.balance === 'percent' ? 'percent' : 'equal', percent: Object.fromEntries(members.map((u) => [u, p.percent[u] ?? 0])), max: {} };
      const before = new Map(Object.entries(load));
      runGroup(g, slots, p.id);
      // A panel smaller than N: "complete" fills the rest from people outside the panel (equally); "lower" leaves the application with the whole panel.
      if (smaller && choice === 'complete') {
        const outside: Group = { members: evaluators.filter((u) => !members.includes(u)), balance: 'equal', percent: {}, max: {} };
        const extra = apps.map((a) => ({ applicationId: a.applicationId, count: Math.max(0, nWanted - holds(a.applicationId).size) })).filter((s) => s.count > 0);
        runGroup(outside, extra);
      }
      const got = (u: string) => load[u] - (before.get(u) ?? 0);
      panelViews.push({ panelId: p.id, name: p.name, applications: apps.length, slots: apps.reduce((n, a) => n + wantedFor(a.applicationId, members), 0), size: members.length, needsChoice: smaller && p.shortfall === null, short: smaller,
        evaluators: members.map((u) => ({ userId: u, requested: p.balance === 'percent' ? p.percent[u] ?? null : null, got: got(u) })) });
    }
    if (c.fallback === 'unassigned') unassigned.push(...fallbackApps.filter((a) => holds(a).size === 0));
    else {
      const g = c.fallback === 'weighted' ? weightedGroup() : everyone;
      runGroup(g, fallbackApps.map((a) => ({ applicationId: a, count: need(evaluators, a, false) })).filter((s) => s.count > 0));
    }
  } else {
    const g = c.strategy === 'weighted' ? weightedGroup() : everyone;
    runGroup(g, inp.applications.map((a) => ({ applicationId: a.applicationId, count: need(evaluators, a.applicationId, false) })).filter((s) => s.count > 0));
  }

  // The shortfalls say how many each application wanted and got, in total.
  const finalShort: AllocOutput['shortfalls'] = [];
  for (const s of shortfalls) {
    if (finalShort.some((x) => x.applicationId === s.applicationId)) continue;
    const wanted = inp.n === 'all' ? evaluators.filter((u) => !blocked.has(key(s.applicationId, u))).length : inp.n;
    finalShort.push({ applicationId: s.applicationId, wanted, got: holds(s.applicationId).size, reason: s.reason });
  }
  const addKey = new Set(add.map((p) => key(p.applicationId, p.userId)));
  const remove: Pair[] = inp.replan ? inp.existing.filter((p) => !p.fixed && !addKey.has(key(p.applicationId, p.userId)) && !hold.get(p.applicationId)?.has(p.userId)).map((p) => ({ applicationId: p.applicationId, userId: p.userId })) : [];
  // A re-decided assignment that comes out the same is not a move: neither added nor removed.
  const existingAll = new Set(inp.existing.map((p) => key(p.applicationId, p.userId)));
  const realAdd = add.filter((p) => !existingAll.has(key(p.applicationId, p.userId)));
  const gw = c.strategy === 'weighted' || (c.strategy === 'rules' && c.fallback === 'weighted');
  const evalViews = gw ? evaluators.map((u) => ({ userId: u, requested: c.weighted.by === 'percent' ? c.weighted.percent[u] ?? null : null, limit: c.weighted.by === 'max' ? c.weighted.max[u] ?? null : null, got: load[u] })) : [];
  const warning = c.strategy === 'rules' && needsChoice.length > 0 ? `${needsChoice.length === 1 ? 'A panel is' : 'Some panels are'} smaller than the number of evaluators per application (${needsChoice.join(', ')}): choose what to do before applying.` : null;
  return { add: realAdd, remove, shortfalls: finalShort, loads: load, evaluators: evalViews, panels: panelViews, unassigned, matched, needsChoice, warning };
}
