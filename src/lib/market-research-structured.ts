// Prompt 445 §C/§D — structured market facts: mandatory and validated at
// write time, never text parsed by regex afterward. Pure types + parse
// only, no network calls — same discipline as market-thesis.ts.
import { createHash } from 'crypto';
import type { Section } from './market-research-sections';
import type { FactStatus } from './market-intelligence-types';

// Prompt 445 §A — lives here (not in research/route.ts) so it's testable:
// Next.js route files may only export the reserved handler names (GET,
// POST, ...) — any other export fails the build's own route type check
// (same constraint market-research-sections.ts's own header documents).
// Cache signature keyed by hypothesis + the CURRENT thesis version (read
// fresh at request time by the caller, never the hypothesis's own frozen
// thesis_version) so an edited thesis invalidates the cache for every
// hypothesis that depends on it, even one that hasn't itself changed.
export function signatureFor(hypothesisId: string, thesisVersion: number, section: Section | null): string {
  return createHash('sha256').update(`${hypothesisId}|${thesisVersion}|${section ?? 'all'}`).digest('hex');
}

export interface SizingStructured {
  valueEur: number; scope: 'TAM' | 'SAM' | 'SOM'; year: number; geography: string;
  method: 'top_down' | 'bottom_up' | 'analyst_report' | 'secondary_citation';
}
export interface GrowthStructured { pct: number; periodYears: number; segment: string | null }
export interface RoundStructured { company: string; amountEur: number; date: string; stage: string }
export interface PlayerStructured {
  company: string;
  competitorType: 'direct' | 'functional' | 'budget' | 'status_quo' | 'emerging' | 'potential_entrant';
}
export type StructuredForSection = SizingStructured | GrowthStructured | RoundStructured | PlayerStructured;

// trends/regulatory/definition stay without typed structured this phase
// (§H) — only the four sections that feed numeric calculation downstream.
export const STRUCTURED_REQUIRED_SECTIONS: Section[] = ['sizing', 'growth', 'rounds', 'players'];

const SIZING_SCOPES = ['TAM', 'SAM', 'SOM'];
const SIZING_METHODS = ['top_down', 'bottom_up', 'analyst_report', 'secondary_citation'];
const COMPETITOR_TYPES = ['direct', 'functional', 'budget', 'status_quo', 'emerging', 'potential_entrant'];

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// Validates shape + required fields per section; returns null if
// incomplete — NEVER invents a missing field. See runResearchPass (the
// route) for what happens to an item with no valid structured: for the
// four required sections above, it is discarded before it is ever saved.
export function parseStructuredForSection(section: Section, raw: unknown): StructuredForSection | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  if (section === 'sizing') {
    const valueEur = num(r.valueEur);
    const scope = str(r.scope);
    const year = num(r.year);
    const geography = str(r.geography);
    const method = str(r.method);
    if (valueEur == null || !scope || !SIZING_SCOPES.includes(scope) || year == null || !geography || !method || !SIZING_METHODS.includes(method)) return null;
    return { valueEur, scope: scope as SizingStructured['scope'], year, geography, method: method as SizingStructured['method'] };
  }
  if (section === 'growth') {
    const pct = num(r.pct);
    const periodYears = num(r.periodYears);
    if (pct == null || periodYears == null) return null;
    return { pct, periodYears, segment: str(r.segment) };
  }
  if (section === 'rounds') {
    const company = str(r.company);
    const amountEur = num(r.amountEur);
    const date = str(r.date);
    const stage = str(r.stage);
    if (!company || amountEur == null || !date || !stage) return null;
    return { company, amountEur, date, stage };
  }
  if (section === 'players') {
    const company = str(r.company);
    const competitorType = str(r.competitorType);
    if (!company || !competitorType || !COMPETITOR_TYPES.includes(competitorType)) return null;
    return { company, competitorType: competitorType as PlayerStructured['competitorType'] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// §D — Prompt 444's "2.5 Evidence Quality Gate" simplified: not a separate
// phase, this function, called at the exact moment the fact is persisted —
// never a later pass.
export function computeFactStatus(input: {
  hasStructured: boolean;
  hasSourceUrl: boolean;
  sourceCount: number; // how many independent sources proposed the SAME fact in this run (§D.1)
  conflictingValues: boolean; // two independent sources with materially incompatible values (§D.2)
}): FactStatus {
  if (!input.hasStructured || !input.hasSourceUrl) return 'INSUFFICIENT_FACT';
  if (input.conflictingValues) return 'CONFLICTING_FACT';
  if (input.sourceCount >= 2) return 'VALIDATED_FACT';
  return 'PARTIAL_FACT';
}

// §D.1 — minimal source independence: within one research run, distinct
// domains among the proposing source URLs count as distinct sources; the
// same domain collapses to one. Full tier A-D independence
// (origin_source/derived_from) is phase 446's job, once the Assessment
// engine needs it for confidence — this is only enough for sourceCount to
// be honest, never eyeballed in the LLM prompt.
export function countIndependentSources(items: { sourceUrl: string }[]): number {
  const domains = new Set<string>();
  for (const item of items) {
    try {
      domains.add(new URL(item.sourceUrl).hostname.replace(/^www\./, ''));
    } catch {
      // An unparseable URL still counts as its own (opaque) source rather
      // than silently vanishing from the count.
      domains.add(item.sourceUrl);
    }
  }
  return domains.size;
}

// §D.2 — 40% is a documented starting threshold, not a sacred constant
// (the prompt's own words) — adjustable later without touching call sites.
export const CONFLICT_THRESHOLD_PCT = 0.4;

// Symmetric by construction (same result regardless of argument order):
// the smaller of the two would need to grow by more than the threshold to
// reach the larger. One value at exactly zero and the other not is always
// a conflict; both at zero is never one.
export function valuesConflict(a: number, b: number): boolean {
  const min = Math.min(Math.abs(a), Math.abs(b));
  if (min === 0) return a !== b;
  return Math.abs(a - b) / min > CONFLICT_THRESHOLD_PCT;
}

function numericFieldOf(structured: StructuredForSection | null): number | null {
  if (!structured) return null;
  if ('valueEur' in structured) return structured.valueEur;
  if ('pct' in structured) return structured.pct;
  return null;
}

export interface RunItemForFactStatus {
  section: Section;
  title: string;
  sourceUrl: string;
  structured: StructuredForSection | null;
}

// Groups items proposed in the SAME run by (section, normalized title) —
// a plain, mechanical key, not fuzzy matching. The system prompt already
// asks the model for consistent titles across items describing the same
// fact; undercounting (the same real-world fact titled two different ways
// landing in separate groups) is the SAFE failure mode here — it can only
// ever miss a chance to raise sourceCount, never inflate one dishonestly.
function factGroupKey(item: { section: Section; title: string }): string {
  return `${item.section}:${item.title.trim().toLowerCase()}`;
}

// Computes FactStatus per item, keyed by its index in the input array, so
// the caller can zip the result straight back against the original items/
// db rows without re-deriving the grouping itself.
export function computeFactStatusForRun(items: RunItemForFactStatus[]): Map<number, FactStatus> {
  const groups = new Map<string, number[]>();
  items.forEach((item, i) => {
    const key = factGroupKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  });

  const result = new Map<number, FactStatus>();
  for (const indices of groups.values()) {
    const groupItems = indices.map((i) => items[i]);
    const sourceCount = countIndependentSources(groupItems.filter((it) => it.sourceUrl).map((it) => ({ sourceUrl: it.sourceUrl })));

    const values = groupItems.map((it) => numericFieldOf(it.structured)).filter((v): v is number => v != null);
    let conflictingValues = false;
    for (let a = 0; a < values.length && !conflictingValues; a++) {
      for (let b = a + 1; b < values.length; b++) {
        if (valuesConflict(values[a], values[b])) { conflictingValues = true; break; }
      }
    }

    for (const i of indices) {
      const item = items[i];
      result.set(i, computeFactStatus({
        hasStructured: !!item.structured, hasSourceUrl: !!item.sourceUrl, sourceCount, conflictingValues,
      }));
    }
  }
  return result;
}
