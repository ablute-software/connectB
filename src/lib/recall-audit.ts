// Prompt 895 (v2) §E — recall audit, restricted scope. Pure function: groups
// catalog_fit() results for one org across a catalog list. See
// src/lib/catalog-fit.ts's header for the full scope note (§A/§B/§C/§D are
// out of scope; this file plus catalog-fit.ts exist only to answer "who is
// excluded today, and why, by name" for Nuno's own stated stop-point).
//
// §E also defines a `research_pending` group for firms that would be
// eligible except for the person-gate (§B.5's proposed change: stop
// excluding a fit firm just because nobody has been researched yet, put it
// in a person-research queue instead). This branch does NOT remove the
// person gate from production (catalog_top_matches keeps requiring a
// contactable person) — `research_pending` here is a REPORTING label only,
// computed from a `hasContactablePerson` flag the caller supplies from
// today's real data, framed exactly as the task asked: "seria elegível sob
// a proposta do §B.5, hoje só bloqueada pela porta da pessoa."
//
// THRESHOLD NOTE (task-mandated, explicit): "below_threshold" uses the same
// >= 55 cut the live production `catalog_top_matches` (migration 0300/0345)
// already uses for delivery. This module's own scoring is NOT the same
// function as production's (see catalog-fit.ts's header — no topic-signal
// bonus, geography basis differs), so a firm's bucket here can legitimately
// differ from what catalog_top_matches would say about it today. That is the
// point of the audit, not a bug: this report answers "what WOULD the recall
// picture look like under the fixed logic Nuno has not yet authorized" —
// not "what does production say today."
import { catalogFit, type CatalogFitResult, type FitCatalogEntityInput, type FitOrgInput } from './catalog-fit.ts';

export const RECALL_AUDIT_SCORE_THRESHOLD = 55;

export type RecallGroup =
  | 'eligible'
  | 'below_threshold'
  | 'research_pending'
  | `hard_excluded:${string}`;

export interface RecallAuditEntityInput extends FitCatalogEntityInput {
  id: string;
  name: string;
  hasContactablePerson: boolean;
}

export interface RecallAuditRow {
  id: string;
  name: string;
  group: RecallGroup;
  fit: CatalogFitResult;
  /** Areas currently `unknown` that, if known, could change eligibility/score/threshold outcome. */
  unknownAreasThatWouldMatter: string[];
  hasContactablePerson: boolean;
}

export interface RecallAuditReport {
  orgLabel: string;
  generatedAt: string;
  totalFirms: number;
  groups: Record<RecallGroup, RecallAuditRow[]>;
  counts: Record<RecallGroup, number>;
  rows: RecallAuditRow[];
}

function unknownAreasThatWouldMatter(fit: CatalogFitResult): string[] {
  // Any unknown scored area is "would matter" if the firm is not already
  // comfortably eligible (score far above threshold) — a cheap, honest
  // proxy: always list unknown areas when the firm is excluded (hard or by
  // threshold) or when confidence < 100, since in every one of those cases
  // learning the missing fact could plausibly move the outcome.
  return fit.parts.filter((p) => !p.known).map((p) => p.area);
}

function classify(fit: CatalogFitResult, hasContactablePerson: boolean): RecallGroup {
  if (!fit.eligible) {
    // One firm can in principle carry more than one hard reason; group by
    // the first for a single bucket, all are preserved on the row's own
    // `fit.hard_reasons`.
    return `hard_excluded:${fit.hard_reasons[0]}`;
  }
  if ((fit.score ?? 0) < RECALL_AUDIT_SCORE_THRESHOLD) return 'below_threshold';
  if (!hasContactablePerson) return 'research_pending';
  return 'eligible';
}

export function recallAudit(
  orgLabel: string,
  org: FitOrgInput,
  entities: RecallAuditEntityInput[],
): RecallAuditReport {
  const rows: RecallAuditRow[] = entities.map((e) => {
    const fit = catalogFit(org, e);
    const group = classify(fit, e.hasContactablePerson);
    return {
      id: e.id,
      name: e.name,
      group,
      fit,
      unknownAreasThatWouldMatter: unknownAreasThatWouldMatter(fit),
      hasContactablePerson: e.hasContactablePerson,
    };
  });

  const groups: Record<string, RecallAuditRow[]> = {};
  const counts: Record<string, number> = {};
  for (const row of rows) {
    (groups[row.group] ??= []).push(row);
    counts[row.group] = (counts[row.group] ?? 0) + 1;
  }

  return {
    orgLabel,
    generatedAt: new Date().toISOString(),
    totalFirms: entities.length,
    groups: groups as Record<RecallGroup, RecallAuditRow[]>,
    counts: counts as Record<RecallGroup, number>,
    rows,
  };
}
