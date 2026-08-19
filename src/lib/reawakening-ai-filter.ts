// Prompt 251/253 Bloco D — the second-pass AI filter's pure, I/O-free core.
// Deliberately its own file, not added to rejection-code-match.ts: that
// file's own header is explicit that "AI has no role here at all" — it
// stays the sole, AI-free detector. This module only ever runs AFTER
// rejection-code-match.ts already decided a code cleared; it never
// re-decides that, it only judges whether/how the resulting suggestion
// should reach the founder. Unit-tested; the AI route and the store
// compose these, same split as reawakening.ts/evaluate's own shape.
import type { PendingReactivation } from './rejection-code-match';

export type FilterVerdictKind = 'pass' | 'enrich' | 'hold';

export interface FilterVerdict {
  verdict: FilterVerdictKind;
  aiNote: string;
  enrichedRationale?: string;
  enrichedTaskTitle?: string;
}

export interface FilterCase {
  rejectionCodeId: string;
  entityName: string;
  axisCode: string;
  levelLabel: string;
  rationale: string;
  priorPassReason?: string;
  priorPassCategory?: string;
}

// The over-the-wire (snake_case, tool-call) shape — shared by the route
// (which produces it) and the store (which consumes it), so neither side
// invents its own copy of this shape.
export interface RawFilterVerdict {
  rejection_code_id: string;
  verdict: FilterVerdictKind;
  ai_note: string;
  enriched_rationale?: string;
  enriched_task_title?: string;
}

export function verdictsFromWire(raw: RawFilterVerdict[]): Map<string, FilterVerdict> {
  return new Map(raw.map((v) => [v.rejection_code_id, {
    verdict: v.verdict, aiNote: v.ai_note, enrichedRationale: v.enriched_rationale, enrichedTaskTitle: v.enriched_task_title,
  }]));
}

export function reactivationToFilterCase(r: PendingReactivation): FilterCase {
  return {
    rejectionCodeId: r.code.id, entityName: r.entity.name,
    axisCode: r.code.axis_code, levelLabel: r.code.level_label,
    rationale: r.rationale,
  };
}

export function buildRejectionFilterPrompt(cases: FilterCase[]): string {
  const list = cases.map((c, i) =>
    `${i + 1}. rejection_code_id=${c.rejectionCodeId} · ${c.entityName}\n`
    + `   axis: ${c.axisCode} (needed: ${c.levelLabel})\n`
    + `   deterministic rationale: ${c.rationale}\n`
    + `   prior pass reason: ${c.priorPassReason ?? '(not recorded)'}${c.priorPassCategory ? ` (${c.priorPassCategory})` : ''}`,
  ).join('\n');
  return 'A deterministic rule already confirmed each of these investor rejections no longer clashes against current data — the specific bar '
    + 'they cited has been reached, or the investor\'s current mandate now passes. That decision is FINAL and not yours to override. Your only '
    + 'job: for EACH case, decide whether resurfacing this investor to the founder right now is a good idea ("pass"), whether the suggested '
    + 'wording could be sharper first ("enrich" — include your own rewritten one-sentence rationale and a short task title), or whether it is '
    + 'clearly premature or too thin a signal and should wait ("hold" — include a one-sentence reason). Default to "pass" when genuinely unsure '
    + '— holding back a real opportunity costs more than a slightly premature nudge.\n\nCASES:\n' + list;
}

// The merge step: which reactivations survive the filter, and with what
// (possibly enriched) wording. `verdicts` missing a case entirely (never
// asked — e.g. this request's batch failed and fell back open) behaves
// exactly like an explicit 'pass': the case is included unchanged. Only an
// explicit 'hold' ever removes a case — the deterministic clash-clear
// itself is never second-guessed here, only whether/how it surfaces.
export function applyFilterVerdicts(
  reactivations: PendingReactivation[],
  verdicts: Map<string, FilterVerdict>,
): { reactivation: PendingReactivation; taskTitleOverride?: string }[] {
  const out: { reactivation: PendingReactivation; taskTitleOverride?: string }[] = [];
  for (const r of reactivations) {
    const v = verdicts.get(r.code.id);
    if (v?.verdict === 'hold') continue;
    if (v?.verdict === 'enrich') {
      out.push({
        reactivation: v.enrichedRationale ? { ...r, rationale: v.enrichedRationale } : r,
        taskTitleOverride: v.enrichedTaskTitle,
      });
    } else {
      out.push({ reactivation: r });
    }
  }
  return out;
}
