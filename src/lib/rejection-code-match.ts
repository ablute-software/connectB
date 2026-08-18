// Prompt 251/253 Bloco B — the deterministic comparison engine: does a
// closed entity's rejection_codes still hold against CURRENT data? Pure,
// no I/O, unit-tested — same shape as reawakening.ts's mechanical
// prefilter. AI has no role here at all (251's own point 4: AI is a
// SECOND filter/argumentation step, applied later if ever, never the
// detector) — this is the whole detector, and it's free to run on every
// write because it's cheap comparisons, not a model call.
//
// "Reusar os eixos já estruturados, não reinventar" (253, approved): for
// the three axes the app already models structurally — stage, sector,
// geography — the check reads the SAME live fields the rest of the app
// already trusts for fit (orgs.stage/sectors/country, entities.stage_min/
// stage_max/sectors/invests_in_geographies), not the frozen snapshot on
// the rejection_code row. That snapshot (required_level/level_label) is
// kept for citation ("the earlier no was about X") and is the ONLY
// signal for a free-text axis_code the app has no structured field for —
// those fall back to org_axis_classifications (0184), still unpopulated
// until a later block adds a writer; until then they conservatively never
// clear (no data ≠ cleared).
import type { Db, Entity, Org, OrgAxisClassification, RejectionCode, Stage } from './types';
import { STAGE_OPTIONS } from './taxonomy';

const STAGE_ORDER: Stage[] = STAGE_OPTIONS.map((s) => s.value);

// undefined for 'other' or an unset stage — deliberately: 'other' is an
// escape hatch with no defined position in the ladder (see its own comment
// in types.ts), so a stage-axis rejection against an 'other'-staged org
// can never be confirmed cleared, only left as-is.
function stageOrdinal(stage: Stage | undefined): number | undefined {
  if (!stage) return undefined;
  const i = STAGE_ORDER.indexOf(stage);
  return i === -1 ? undefined : i;
}

export type StructuredAxis = 'stage' | 'sector' | 'geography';
export function isStructuredAxis(axisCode: string): axisCode is StructuredAxis {
  return axisCode === 'stage' || axisCode === 'sector' || axisCode === 'geography';
}

// True while the rejection still holds against CURRENT data — i.e. no
// reactivation signal. False is the interesting case: the code cleared.
export function rejectionStillClashes(
  code: RejectionCode,
  org: Pick<Org, 'stage' | 'sectors' | 'country'>,
  entity: Pick<Entity, 'stage_min' | 'stage_max' | 'sectors' | 'invests_in_geographies'>,
  axisClassifications: OrgAxisClassification[],
): boolean {
  switch (code.axis_code) {
    case 'stage': {
      const orgIdx = stageOrdinal(org.stage);
      if (orgIdx === undefined) return true; // unknown stage — can't confirm cleared
      // required_level is the SPECIFIC bar this investor cited for THIS
      // rejection — can be more specific than their coarse stage_min/max
      // (e.g. "needs to be live in market", not just "seed-stage or
      // later"). Checked first because it's the citable reason.
      if (orgIdx < code.required_level) return true;
      // Independent second gate (253's investor-side trigger): even a
      // startup that cleared the ORIGINAL bar can still fail the
      // investor's CURRENT mandate if stage_min/stage_max moved since.
      const minIdx = stageOrdinal(entity.stage_min);
      const maxIdx = stageOrdinal(entity.stage_max);
      if (minIdx !== undefined && orgIdx < minIdx) return true;
      if (maxIdx !== undefined && orgIdx > maxIdx) return true;
      return false;
    }
    case 'sector': {
      // No sector mandate recorded on the investor side — nothing to clash
      // against, so this axis was never really the blocker; don't claim one.
      if (!entity.sectors?.length) return false;
      return !(org.sectors ?? []).some((s) => entity.sectors.includes(s));
    }
    case 'geography': {
      if (!entity.invests_in_geographies?.length) return false;
      // Same plain-membership check computeMatchScore already uses for its
      // own geography component (investor-match-score.ts) — no region/
      // country hierarchy exists anywhere in this codebase to be smarter
      // than that, so this doesn't invent one either.
      return !(org.country && entity.invests_in_geographies.includes(org.country));
    }
    default: {
      const latest = axisClassifications
        .filter((c) => c.axis_code === code.axis_code)
        .sort((a, b) => a.confirmed_at.localeCompare(b.confirmed_at))
        .at(-1);
      if (!latest) return true; // no classification yet — can't confirm cleared
      return latest.level < code.required_level;
    }
  }
}

// The codes that JUST stopped clashing, given a set of already-known
// (already-proposed) code ids to skip — dedup lives in the caller (checks
// reawakening_proposals), this only ever answers "does the data say clear".
export function clearedRejectionCodes(
  codes: RejectionCode[],
  org: Pick<Org, 'stage' | 'sectors' | 'country'>,
  entity: Pick<Entity, 'stage_min' | 'stage_max' | 'sectors' | 'invests_in_geographies'>,
  axisClassifications: OrgAxisClassification[],
  alreadyProposedCodeIds: Set<string> | string[],
): RejectionCode[] {
  const proposed = alreadyProposedCodeIds instanceof Set ? alreadyProposedCodeIds : new Set(alreadyProposedCodeIds);
  return codes.filter((c) => !proposed.has(c.id) && !rejectionStillClashes(c, org, entity, axisClassifications));
}

const AXIS_LABEL: Record<string, string> = { stage: 'stage', sector: 'sector', geography: 'geography' };

// Deterministic rationale — no AI. "Passaram por z2; o plano agora inclui
// DACH" is the shape: name the axis + the bar that used to block, in one
// citable line the founder can paste straight into a re-approach.
export function rejectionClearedRationale(code: RejectionCode): string {
  const axis = AXIS_LABEL[code.axis_code] ?? code.axis_code;
  return `Passed earlier over ${axis} (needed: ${code.level_label}) — that bar looks cleared now. Cite the earlier "no" when re-approaching.`;
}

export function reactivationTaskTitle(entityName: string, code: RejectionCode): string {
  const axis = AXIS_LABEL[code.axis_code] ?? code.axis_code;
  return `Revisit ${entityName} — ${axis} bar may be cleared`;
}

export interface PendingReactivation {
  code: RejectionCode;
  entity: Entity;
  rationale: string;
}

// The orchestration step: which (entity, code) pairs are worth surfacing
// right now. Only 'passed' entities are candidates — rejection_codes are
// captured exclusively from the pass flow (RelationshipSummaryCard's "No
// interest / over"), so a merely-dormant entity structurally has none to
// compare; scoping to 'passed' here is precise, not a shortcut.
//
// `entityIds`, when given, narrows which entities to re-check — the
// on-write callers pass either the one entity that changed (updateEntity,
// addRejectionCode) or omit it entirely to re-check everyone (updateOrg:
// the startup itself changed, which can affect any investor's codes).
// Single-org app (Db.org is one row, not a table) — there is exactly one
// "startup" to compare every investor's codes against.
export function findReactivations(
  db: Pick<Db, 'org' | 'entities' | 'rejectionCodes' | 'orgAxisClassifications' | 'reawakeningProposals'>,
  entityIds?: string[],
): PendingReactivation[] {
  const alreadyProposed = new Set(
    db.reawakeningProposals.filter((p): p is typeof p & { rejection_code_id: string } => !!p.rejection_code_id)
      .map((p) => p.rejection_code_id),
  );
  const targets = db.entities.filter((e) => e.status === 'passed' && (!entityIds || entityIds.includes(e.id)));
  const out: PendingReactivation[] = [];
  for (const entity of targets) {
    const codes = db.rejectionCodes.filter((c) => c.entity_id === entity.id);
    if (codes.length === 0) continue;
    const cleared = clearedRejectionCodes(codes, db.org, entity, db.orgAxisClassifications, alreadyProposed);
    for (const c of cleared) out.push({ code: c, entity, rationale: rejectionClearedRationale(c) });
  }
  return out;
}
