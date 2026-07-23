// F — fact-triggered reawakening: the pure, I/O-free core. Unit-tested; the
// AI route and the store compose these. NOTHING here calls the model or the
// DB — the model runs server-side, once per fact confirmation, on the
// shortlist this module produces. There is NO periodic/scheduled path by
// design: the only trigger is a confirmed canon fact.
import type { Entity, FitScore, Interaction, PassReasonCategory } from './types';

// The mechanical prefilter (step 1): a candidate for reawakening is an entity
// that was set aside (dormant/passed) AND carries a reopen_trigger (the earlier
// "no" + what would have to change), MINUS any (fact_id, entity_id) pair
// already evaluated for this fact — that dedup is `evaluatedEntityIds`, the set
// of entity ids that already have a proposal row for this fact. Pure & cheap:
// no AI is consulted here, and an empty result means zero AI calls.
export function prefilterEntities(entities: Entity[], evaluatedEntityIds: Set<string> | string[]): Entity[] {
  const evaluated = evaluatedEntityIds instanceof Set ? evaluatedEntityIds : new Set(evaluatedEntityIds);
  return entities.filter((e) =>
    (e.status === 'dormant' || e.status === 'passed')
    && !!e.reopen_trigger && e.reopen_trigger.trim().length > 0
    && !evaluated.has(e.id));
}

// The entity's prior "no", read from its interactions (pass_reason lives on the
// interaction, not the entity). Returns the most recent pass's reason+category
// so the proposal can cite the earlier no verbatim.
export function priorPassInfo(interactions: Interaction[]): { reason?: string; category?: PassReasonCategory } {
  const passes = interactions
    .filter((i) => i.classification === 'pass')
    .sort((a, b) => (b.occurred_at ?? '').localeCompare(a.occurred_at ?? ''));
  const latest = passes[0];
  if (!latest) return {};
  return { reason: latest.pass_reason, category: latest.pass_reason_category };
}

// Cap the shortlist per AI call. The spec's guard: chunk if >40 so one batched
// call never blows past a sane size.
export const REAWAKEN_CHUNK = 40;
export function chunk<T>(arr: T[], size = REAWAKEN_CHUNK): T[][] {
  if (size < 1) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// The AI verdict → proposal status rule (step 3): reopens:true awaits the
// founder ('pending'); reopens:false is recorded evaluated but not surfaced
// ('dismissed'). Either way the (fact_id, entity_id) pair is now evaluated and
// never re-proposed.
export function proposalStatusForVerdict(reopens: boolean): 'pending' | 'dismissed' {
  return reopens ? 'pending' : 'dismissed';
}

// Approval effects (step 3, approve branch): the entity returns to the active
// pipeline ('contacted') with the suggested wave/fit (overridable at approval),
// plus a follow-up agenda task. Pure so both store providers share one
// definition and it's unit-testable without a store.
export interface ReawakenApproval {
  entityPatch: { status: 'contacted'; wave?: number; fit_score?: FitScore };
  task: { title: string; entity_id: string; kind: 'follow_up'; action_type: 'follow_up_no_reply' };
}
export function buildReawakenApproval(
  p: { entity_id: string; suggested_wave?: number; suggested_fit?: FitScore; fact_statement?: string },
  entityName: string,
  overrides?: { wave?: number; fit?: FitScore },
): ReawakenApproval {
  const wave = overrides?.wave ?? p.suggested_wave;
  const fit = overrides?.fit ?? p.suggested_fit;
  return {
    entityPatch: {
      status: 'contacted',
      ...(wave != null ? { wave } : {}),
      ...(fit ? { fit_score: fit } : {}),
    },
    task: {
      title: `Reabordar ${entityName}${p.fact_statement ? ` — ${p.fact_statement.slice(0, 60)}` : ''}`,
      entity_id: p.entity_id,
      kind: 'follow_up',
      action_type: 'follow_up_no_reply',
    },
  };
}
