// Prompt 922 (I1) — the evaluation grid (Etapa 3): criteria with a weight, a scale chosen by the ENTITY (nothing fixed in the code: a preset or custom minimum and maximum, step always 1, a different scale
// per criterion if wanted), a description per level or per range, "comment required", an optional minimum that FLAGS (never excludes) — and the weighted average. Pure: no I/O, no React.
//
// The weighted average converts each score to the same base (0–100 %) BEFORE weighting, so criteria with different scales can be added; the ranking shows the final grade in %, and also on the scale when
// every criterion uses the same one. The data model carries a `format` per criterion for later (Yes/No, category, ranking); only `scale` is active in v1 and the others are never shown.
export const CRITERION_FORMATS = ['scale'] as const;
export type CriterionFormat = (typeof CRITERION_FORMATS)[number];

/** The shortcuts of the scale picker; "custom" is any minimum and maximum. The step is always 1. */
export const SCALE_PRESETS: { key: string; label: string; min: number; max: number }[] = [
  { key: '1-5', label: '1–5', min: 1, max: 5 }, { key: '1-10', label: '1–10', min: 1, max: 10 }, { key: '0-10', label: '0–10', min: 0, max: 10 },
];
/** More than this many levels and the evaluator's buttons side by side would not fit a screen: the scale is limited to 0…20 and at most 21 levels (a detail decision of 27/10/2026). */
export const MAX_SCALE_LEVELS = 21;
export const MAX_SCALE_VALUE = 100;
export const MAX_CRITERIA = 60;
export const MAX_SECTION_NAME = 80;
export const MAX_CRITERION_NAME = 160;
export const MAX_GUIDANCE = 1500;
export const MAX_LEVEL_TEXT = 300;

export interface LevelDescription { from: number; to: number; text: string }

export interface Criterion {
  id: string;
  /** An optional section the criterion is shown under. */
  section: string | null;
  position: number;
  name: string;
  /** What the evaluator is told to look at. */
  guidance: string;
  /** In percent; the weights of the grid add up to 100. */
  weight: number;
  format: CriterionFormat;
  scaleMin: number;
  scaleMax: number;
  /** A description per level (from = to) or per range ("1–3: weak"). Optional; ranges only above five levels. */
  levels: LevelDescription[];
  commentRequired: boolean;
  /** Eliminatory (optional): a score BELOW it flags the application — it is never excluded automatically. */
  minScore: number | null;
}

export type DivergenceSettings = { enabled: boolean; scalePct: number; totalPct: number };
export interface GridSettings {
  /** How many evaluators each application gets: a number (default 2, no maximum) or all of them. */
  evaluatorsPerApplication: number | 'all';
  /** The evaluator does not see who applied (the startup, its people, their emails). The administrator always sees everything. */
  blind: boolean;
  /** "Comment required" for every criterion. */
  commentRequiredForAll: boolean;
  /** Flags applications where two evaluators give very different scores on a criterion (≥ scalePct % of the scale) or in total (≥ totalPct %). Never changes a score or decides anything. */
  divergence: DivergenceSettings;
  /** The deadline of the evaluation in each phase (a day, in the call's time zone). */
  deadlines: { phaseId: string; day: string }[];
}

export const DEFAULT_SETTINGS: GridSettings = {
  evaluatorsPerApplication: 2, blind: false, commentRequiredForAll: false, divergence: { enabled: true, scalePct: 40, totalPct: 20 }, deadlines: [],
};

export const scaleLevels = (c: Pick<Criterion, 'scaleMin' | 'scaleMax'>): number[] => Array.from({ length: c.scaleMax - c.scaleMin + 1 }, (_, i) => c.scaleMin + i);
export const scaleLabel = (c: Pick<Criterion, 'scaleMin' | 'scaleMax'>): string => `${c.scaleMin}–${c.scaleMax}`;
export const presetKeyOf = (c: Pick<Criterion, 'scaleMin' | 'scaleMax'>): string => SCALE_PRESETS.find((p) => p.min === c.scaleMin && p.max === c.scaleMax)?.key ?? 'custom';

const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

// --- Weights -------------------------------------------------------------------------------------------------------------------------------------------

export const weightsSum = (cs: Pick<Criterion, 'weight'>[]): number => round(cs.reduce((n, c) => n + c.weight, 0), 3);
export const weightsOk = (cs: Pick<Criterion, 'weight'>[]): boolean => cs.length > 0 && Math.abs(weightsSum(cs) - 100) < 0.001;

/** "Sum of the weights: 100 % ✓" / "… 90 % — 10 % missing" / "… 110 % — 10 % over". */
export function weightsLine(cs: Pick<Criterion, 'weight'>[]): { ok: boolean; sum: number; text: string } {
  const sum = weightsSum(cs);
  if (cs.length === 0) return { ok: false, sum, text: 'Add at least one criterion.' };
  if (Math.abs(sum - 100) < 0.001) return { ok: true, sum, text: 'Sum of the weights: 100 % ✓' };
  const diff = round(Math.abs(100 - sum), 3);
  return { ok: false, sum, text: `Sum of the weights: ${sum} % — ${diff} % ${sum < 100 ? 'missing' : 'over'}` };
}

// --- Scores → percent → weighted average -------------------------------------------------------------------------------------------------------

/** A score as a fraction of its scale: the minimum is 0 %, the maximum 100 %. */
export const toPercent = (score: number, c: Pick<Criterion, 'scaleMin' | 'scaleMax'>): number => (score - c.scaleMin) / (c.scaleMax - c.scaleMin) * 100;

export const sameScale = (cs: Pick<Criterion, 'scaleMin' | 'scaleMax'>[]): { min: number; max: number } | null =>
  cs.length > 0 && cs.every((c) => c.scaleMin === cs[0].scaleMin && c.scaleMax === cs[0].scaleMax) ? { min: cs[0].scaleMin, max: cs[0].scaleMax } : null;

export interface Grade {
  /** The weighted average, in % of the scale (0–100). null until every criterion has a score: an incomplete grid has no total. */
  percent: number | null;
  /** The same on the scale of the grid, when every criterion uses the same one ("3.45 / 5"). null otherwise. */
  onScale: { value: number; min: number; max: number } | null;
  /** Criteria with a score, of all. */
  scored: number; total: number;
}

/** The final grade of one evaluation. `scores` is criterion id → score. Weights are normalised to their sum, so a grid in the middle of being built still gives a coherent figure. */
export function weightedGrade(criteria: Pick<Criterion, 'id' | 'weight' | 'scaleMin' | 'scaleMax'>[], scores: Record<string, number | null | undefined>): Grade {
  const scored = criteria.filter((c) => typeof scores[c.id] === 'number').length;
  if (criteria.length === 0 || scored < criteria.length) return { percent: null, onScale: null, scored, total: criteria.length };
  const wsum = criteria.reduce((n, c) => n + c.weight, 0);
  const pct = wsum > 0 ? criteria.reduce((n, c) => n + c.weight * toPercent(scores[c.id] as number, c), 0) / wsum : 0;
  const same = sameScale(criteria);
  return { percent: round(pct, 2), onScale: same ? { value: round(same.min + (pct / 100) * (same.max - same.min), 2), min: same.min, max: same.max } : null, scored, total: criteria.length };
}

/** "72.5 %" and, when the scale is the same everywhere, "3.9 / 5". */
export function gradeText(g: Grade): string {
  if (g.percent === null) return 'N/A';
  return g.onScale ? `${g.onScale.value} / ${g.onScale.max} (${g.percent} %)` : `${g.percent} %`;
}

/** Criteria whose score is below their eliminatory minimum — the application is flagged, never excluded. */
export function belowMinimum(criteria: Pick<Criterion, 'id' | 'name' | 'minScore'>[], scores: Record<string, number | null | undefined>): { id: string; name: string; score: number; min: number }[] {
  return criteria.flatMap((c) => (c.minScore !== null && typeof scores[c.id] === 'number' && (scores[c.id] as number) < c.minScore ? [{ id: c.id, name: c.name, score: scores[c.id] as number, min: c.minScore }] : []));
}

/** The description that applies to a level (a per-level text first, else the range that contains it). */
export function levelDescription(c: Pick<Criterion, 'levels'>, score: number): string | null {
  const exact = c.levels.find((l) => l.from === score && l.to === score);
  if (exact) return exact.text;
  return c.levels.find((l) => l.from <= score && score <= l.to)?.text ?? null;
}

// --- Reading what the editor sent -----------------------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '');
const intIn = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export type ParsedGrid = { ok: true; criteria: Criterion[] } | { ok: false; error: string };

/**
 * The criteria the editor sent, read strictly. It does NOT require the weights to add up to 100 (a grid is saved while it is being built; the step shows ⚠ and the call cannot be confirmed until they do):
 * every other rule is enforced — a name, a weight between 0 and 100, a scale with a minimum below its maximum and at most 21 levels, descriptions inside the scale, the minimum inside the scale.
 */
export function parseCriteriaPayload(raw: unknown): ParsedGrid {
  if (!Array.isArray(raw)) return { ok: false, error: 'The criteria must be a list.' };
  if (raw.length > MAX_CRITERIA) return { ok: false, error: `A grid can have at most ${MAX_CRITERIA} criteria.` };
  const out: Criterion[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as Record<string, unknown> | null;
    if (!r || typeof r !== 'object') return { ok: false, error: `Criterion ${i + 1} is not valid.` };
    const name = clean(r.name, MAX_CRITERION_NAME);
    const where = `Criterion ${i + 1}${name ? ` (“${name}”)` : ''}`;
    if (!name) return { ok: false, error: `${where}: give it a name.` };
    const weight = typeof r.weight === 'number' || (typeof r.weight === 'string' && r.weight.trim() !== '') ? Number(r.weight) : NaN;
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) return { ok: false, error: `${where}: the weight is a percentage between 0 and 100.` };
    const format = (CRITERION_FORMATS as readonly string[]).includes(String(r.format ?? 'scale')) ? 'scale' : null;
    if (format === null) return { ok: false, error: `${where}: this kind of criterion is not available yet.` };
    const scaleMin = intIn(r.scaleMin, 0, MAX_SCALE_VALUE); const scaleMax = intIn(r.scaleMax, 0, MAX_SCALE_VALUE);
    if (scaleMin === null || scaleMax === null || scaleMax <= scaleMin) return { ok: false, error: `${where}: the scale needs a minimum below its maximum.` };
    if (scaleMax - scaleMin + 1 > MAX_SCALE_LEVELS) return { ok: false, error: `${where}: a scale can have at most ${MAX_SCALE_LEVELS} levels (the evaluator picks one with a button).` };
    const levels: LevelDescription[] = [];
    for (const l of Array.isArray(r.levels) ? (r.levels as Record<string, unknown>[]) : []) {
      const from = intIn(l?.from, scaleMin, scaleMax); const to = intIn(l?.to ?? l?.from, scaleMin, scaleMax); const t = clean(l?.text, MAX_LEVEL_TEXT);
      if (from === null || to === null || to < from) return { ok: false, error: `${where}: a description must sit inside the scale ${scaleMin}–${scaleMax}.` };
      if (!t) continue;
      if (from !== to && scaleMax - scaleMin + 1 <= 5) return { ok: false, error: `${where}: ranges are for scales with more than 5 levels; describe each level instead.` };
      levels.push({ from, to, text: t });
    }
    const minScore = r.minScore === null || r.minScore === undefined || r.minScore === '' ? null : intIn(r.minScore, scaleMin, scaleMax);
    if (r.minScore !== null && r.minScore !== undefined && r.minScore !== '' && minScore === null) return { ok: false, error: `${where}: the eliminatory minimum must be inside the scale ${scaleMin}–${scaleMax}.` };
    let id = typeof r.id === 'string' && UUID.test(r.id) ? r.id : globalThis.crypto.randomUUID();
    if (ids.has(id)) id = globalThis.crypto.randomUUID();
    ids.add(id);
    out.push({ id, section: clean(r.section, MAX_SECTION_NAME) || null, position: i, name, guidance: text(r.guidance, MAX_GUIDANCE), weight: round(weight, 3), format, scaleMin, scaleMax, levels, commentRequired: r.commentRequired === true, minScore });
  }
  return { ok: true, criteria: out };
}

export function parseSettingsPayload(raw: unknown, phaseIds: string[] = []): { ok: true; settings: GridSettings } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let n: number | 'all' = DEFAULT_SETTINGS.evaluatorsPerApplication;
  if (r.evaluatorsPerApplication === 'all') n = 'all';
  else if (r.evaluatorsPerApplication !== undefined) {
    const v = intIn(r.evaluatorsPerApplication, 1, 1000);
    if (v === null) return { ok: false, error: 'The number of evaluators per application is a whole number of at least 1, or “all”.' };
    n = v;
  }
  const d = (r.divergence && typeof r.divergence === 'object' ? r.divergence : {}) as Record<string, unknown>;
  const scalePct = d.scalePct === undefined ? DEFAULT_SETTINGS.divergence.scalePct : intIn(d.scalePct, 1, 100);
  const totalPct = d.totalPct === undefined ? DEFAULT_SETTINGS.divergence.totalPct : intIn(d.totalPct, 1, 100);
  if (scalePct === null || totalPct === null) return { ok: false, error: 'The divergence limits are percentages between 1 and 100.' };
  const deadlines: GridSettings['deadlines'] = [];
  for (const x of Array.isArray(r.deadlines) ? (r.deadlines as Record<string, unknown>[]) : []) {
    const phaseId = typeof x?.phaseId === 'string' ? x.phaseId : '';
    const day = clean(x?.day, 10);
    if (!day) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return { ok: false, error: 'A deadline is a date.' };
    if (phaseIds.length > 0 && !phaseIds.includes(phaseId)) return { ok: false, error: 'A deadline must belong to a phase of the call.' };
    deadlines.push({ phaseId, day });
  }
  return { ok: true, settings: { evaluatorsPerApplication: n, blind: r.blind === true, commentRequiredForAll: r.commentRequiredForAll === true, divergence: { enabled: d.enabled !== false, scalePct, totalPct }, deadlines } };
}

/** Whether the grid can be used to evaluate: criteria, weights adding up to 100, and a name on every one. The step says what is wrong. */
export function gridProblems(cs: Criterion[]): string[] {
  const out: string[] = [];
  if (cs.length === 0) { out.push('The evaluation grid has no criteria.'); return out; }
  const w = weightsLine(cs);
  if (!w.ok) out.push(`The weights add up to ${w.sum} %, not 100 %${w.sum < 100 ? ` (${round(100 - w.sum, 3)} % missing)` : ` (${round(w.sum - 100, 3)} % over)`}.`);
  for (const c of cs) if (c.weight === 0) out.push(`“${c.name}” has a weight of 0 %: it would not count.`);
  return out;
}

// --- "As the evaluator will see it" -------------------------------------------------------------------------------------------------------------

/** The formula in words, with the weights ("Final grade = weighted average = Team × 25 % + Technology × 75 %"), and what a score of every level gives. */
export function formulaText(cs: Pick<Criterion, 'name' | 'weight' | 'scaleMin' | 'scaleMax'>[]): string {
  if (cs.length === 0) return 'No criteria yet.';
  const same = sameScale(cs);
  return `Final grade = weighted average${same ? ` on a ${same.min}–${same.max} scale` : ' (each score converted to % of its own scale first)'} = ${cs.map((c) => `${c.name} × ${c.weight} %`).join(' + ')}`;
}

/** Examples calculated on the grid: every criterion at its maximum, at its minimum, and at the middle. */
export function exampleGrades(cs: Criterion[]): { label: string; grade: Grade }[] {
  if (cs.length === 0) return [];
  const all = (f: (c: Criterion) => number) => Object.fromEntries(cs.map((c) => [c.id, f(c)]));
  return [
    { label: 'Every criterion at its maximum', grade: weightedGrade(cs, all((c) => c.scaleMax)) },
    { label: 'Every criterion at the middle of its scale', grade: weightedGrade(cs, all((c) => Math.round((c.scaleMin + c.scaleMax) / 2))) },
    { label: 'Every criterion at its minimum', grade: weightedGrade(cs, all((c) => c.scaleMin)) },
  ];
}

// --- Descriptions as text, for the editor --------------------------------------------------------------------------------------------------------

/** One line per description: "5: excellent" or "1–3: weak". */
export const levelsToText = (ls: LevelDescription[]): string => ls.map((l) => (l.from === l.to ? `${l.from}: ${l.text}` : `${l.from}–${l.to}: ${l.text}`)).join('\n');

/** The reverse. A line that does not read as "level: text" or "from–to: text" is ignored (the server checks the rest). */
export function textToLevels(t: string): LevelDescription[] {
  const out: LevelDescription[] = [];
  for (const line of t.split('\n')) {
    const m = line.match(/^\s*(\d{1,3})(?:\s*(?:-|–|—|to)\s*(\d{1,3}))?\s*[:=)]\s*(.+?)\s*$/);
    if (m) out.push({ from: Number(m[1]), to: m[2] ? Number(m[2]) : Number(m[1]), text: m[3] });
  }
  return out;
}
