// Prompt 716 — "What would need to change for you to look again?" Shares
// Prompt 715's chip vocabulary (only offered after too_early/traction/
// team_execution/valuation) and episode/mandate substrate. Deterministic
// throughout: fulfillment is a regex/category match against a declared
// source table, never a language-model judgement (Pedido B's own explicit
// instruction).
//
// CLIENT-SAFE — no server-only import here on purpose. PipelinePanel.tsx
// (a client component) pulls in CONDITION_OPTIONS/CONDITION_TRIGGER_CHIPS
// directly; recordReevaluationCondition (which needs investor-watching-db,
// itself `import 'server-only'`) lives in reevaluation-conditions-server.ts
// instead — confirmed the hard way: a single shared file broke the client
// bundle ("You're importing a component that needs server-only") the
// moment PipelinePanel imported anything from this module at all.
import type { SupabaseClient } from '@supabase/supabase-js';

export type ConditionKind =
  | 'first_customer' | 'pilot_completed' | 'recurring_revenue' | 'technical_validation'
  | 'regulatory_milestone' | 'team_complete' | 'lead_investor_confirmed' | 'new_round_condition'
  | 'date' | 'never_show_again';

export interface ConditionOption { id: ConditionKind; label: string; hasOptionalValue?: boolean }

// Pedido A §2 — offered only when the pass chip is one of these.
export const CONDITION_TRIGGER_CHIPS = new Set(['too_early', 'traction', 'team_execution', 'valuation']);

export const CONDITION_OPTIONS: ConditionOption[] = [
  { id: 'first_customer', label: 'First customer' },
  { id: 'pilot_completed', label: 'Pilot completed' },
  { id: 'recurring_revenue', label: 'Recurring revenue', hasOptionalValue: true },
  { id: 'technical_validation', label: 'Technical validation' },
  { id: 'regulatory_milestone', label: 'Regulatory milestone' },
  { id: 'team_complete', label: 'Team complete', hasOptionalValue: true },
  { id: 'lead_investor_confirmed', label: 'Lead investor confirmed' },
  { id: 'new_round_condition', label: 'New round condition (valuation/ticket)' },
  { id: 'date', label: 'A specific date' },
  { id: 'never_show_again', label: "Don't show me this startup again" },
];

// Pedido B — no field exists for this today (checked: neither `orgs` nor
// any related table has a lead-investor flag) — per the prompt's own
// "verificar" instruction, this stays permanently undetectable rather than
// inventing a column. Never generates an alert; recorded (Pedido A: "as
// condições gravam-se e mais nada" is the honest floor for this one kind,
// forever, not just until 715 ships).
export const UNDETECTABLE_CONDITION_KINDS = new Set<ConditionKind>(['lead_investor_confirmed']);

// A condition kind needs founder consent (an investor_watches row) unless
// it's a pure investor-side reminder ('date') or needs nothing at all
// ('never_show_again').
export function conditionNeedsConsent(kind: ConditionKind): boolean {
  return kind !== 'date' && kind !== 'never_show_again';
}

const CATEGORY_LABEL: Record<ConditionKind, string> = {
  first_customer: 'first customer', pilot_completed: 'pilot completed', recurring_revenue: 'recurring revenue',
  technical_validation: 'technical validation', regulatory_milestone: 'regulatory milestone',
  team_complete: 'team complete', lead_investor_confirmed: 'lead investor confirmed',
  new_round_condition: 'new round condition', date: 'a specific date', never_show_again: "don't show again",
};
export function conditionKindLabel(kind: ConditionKind): string {
  return CATEGORY_LABEL[kind];
}

// Keyword matches, deterministic. English AND Portuguese variants — this
// codebase's own founder-facing text is bilingual by nature of who types
// roadmap/claim text in.
const ROADMAP_KEYWORDS: Partial<Record<ConditionKind, RegExp>> = {
  pilot_completed: /\bpiloto|\bpilot\b/i,
  technical_validation: /valida[cç][aã]o t[ée]cnica|technical validation|\bprova de conceito|\bpoc\b/i,
  regulatory_milestone: /regulat[oó]ri[oa]|certifica[cç][aã]o|regulatory|certification|marco legal|approval/i,
};

export interface DetectedFulfillment { factText: string; sourceTable: string; sourceId: string }

// Returns the fulfillment fact, or null if the condition's kind isn't met
// yet (or has no deterministic source at all, e.g. lead_investor_confirmed).
export async function detectConditionFulfillment(
  admin: SupabaseClient, orgId: string, kind: ConditionKind, sinceIso: string,
): Promise<DetectedFulfillment | null> {
  if (UNDETECTABLE_CONDITION_KINDS.has(kind)) return null;

  if (kind === 'pilot_completed' || kind === 'technical_validation' || kind === 'regulatory_milestone') {
    const regex = ROADMAP_KEYWORDS[kind]!;
    const { data } = await admin.from('roadmap_events').select('id, title, description, updated_at')
      .eq('org_id', orgId).eq('status', 'done').gt('updated_at', sinceIso);
    const match = (data ?? []).find((e) => regex.test((e.title as string) ?? '') || regex.test((e.description as string) ?? ''));
    if (!match) return null;
    return { factText: match.title as string, sourceTable: 'roadmap_events', sourceId: match.id as string };
  }

  if (kind === 'first_customer' || kind === 'recurring_revenue') {
    const regex = kind === 'first_customer'
      ? /primeiro cliente|first customer|first paying/i
      : /receita recorrente|recurring revenue|\bmrr\b|\barr\b/i;
    const { data } = await admin.from('company_claims').select('id, statement, updated_at')
      .eq('org_id', orgId).eq('category', 'tracao_gtm').eq('status', 'accepted').gt('updated_at', sinceIso);
    const match = (data ?? []).find((c) => regex.test((c.statement as string) ?? ''));
    if (!match) return null;
    return { factText: match.statement as string, sourceTable: 'company_claims', sourceId: match.id as string };
  }

  if (kind === 'team_complete') {
    const { data } = await admin.from('company_claims').select('id, statement, updated_at')
      .eq('org_id', orgId).eq('category', 'equipa').eq('status', 'accepted').gt('updated_at', sinceIso);
    const match = (data ?? [])[0];
    if (!match) return null;
    return { factText: match.statement as string, sourceTable: 'company_claims', sourceId: match.id as string };
  }

  if (kind === 'new_round_condition') {
    // Reuses the exact fields orgs.round_target_eur/round_min_ticket_eur/
    // round_instruments already track — no new source, per Pedido B's own
    // table row ("campos da ronda em orgs").
    const { data: org } = await admin.from('orgs').select('round_target_eur, round_min_ticket_eur, round_instruments, updated_at').eq('id', orgId).maybeSingle();
    if (!org || !org.updated_at || (org.updated_at as string) <= sinceIso) return null;
    return { factText: 'The round terms changed', sourceTable: 'orgs', sourceId: orgId };
  }

  return null;
}

// Pedido C — the template sentence, never a language model. The obstacle
// label is the human name of the ORIGINAL chip (Prompt 715), never the
// private chip id or note.
export function reapresentationMessage(obstacleLabel: string, factText: string, factDateIso: string): string {
  const date = new Date(factDateIso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return `You asked to look again after ${obstacleLabel}. The startup declared "${factText}" on ${date}. Declared by the startup, not verified.`;
}
