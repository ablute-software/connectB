// Prompt 715 Pedido C — the investor's "Current context" card: a temporary
// priority note, an optional pause on new discovery candidates, an optional
// analysis-capacity hint (registered for fase 4, no effect here), and a
// date past which the card stops mattering on its own — "nunca se prolonga
// sozinho".
import type { SupabaseClient } from '@supabase/supabase-js';

export interface InvestorContext {
  priorityNote: string | null;
  pauseNewCandidates: boolean;
  capacity: 'few' | 'normal' | 'many' | null;
  expiresAt: string | null;
  expiryLabel: 'valid_until' | 'review_by' | null;
  suggestionDismissedAt: string | null;
  updatedAt: string;
}

export async function getInvestorContext(admin: SupabaseClient, investorCatalogEntityId: string): Promise<InvestorContext | null> {
  const { data } = await admin.from('investor_context').select('*').eq('investor_catalog_entity_id', investorCatalogEntityId).maybeSingle();
  if (!data) return null;
  return {
    priorityNote: data.priority_note as string | null,
    pauseNewCandidates: !!data.pause_new_candidates,
    capacity: data.capacity as 'few' | 'normal' | 'many' | null,
    expiresAt: data.expires_at as string | null,
    expiryLabel: data.expiry_label as 'valid_until' | 'review_by' | null,
    suggestionDismissedAt: data.suggestion_dismissed_at as string | null,
    updatedAt: data.updated_at as string,
  };
}

// Whether the card's expiry date, if any, has passed. An expired card
// keeps its own values on record (so the About panel can show "expired —
// confirm or remove") but never re-extends itself.
export function isContextExpired(context: Pick<InvestorContext, 'expiresAt'> | null, nowIso: string): boolean {
  return !!context?.expiresAt && context.expiresAt < nowIso;
}

// Prompt 715 Pedido G's own hook: "a admissão do Pedido G não reserva
// enquanto a pausa estiver activa". A pause that has expired has no effect
// — same rule as every other field on this card.
export function isPauseActive(context: InvestorContext | null, nowIso: string): boolean {
  if (!context?.pauseNewCandidates) return false;
  return !isContextExpired(context, nowIso);
}

// Prompt 715 Pedido C — "capital_to_deploy_eur ganha …_confirmed_at;
// passados 90 dias sem confirmação, o About mostra 'por confirmar'".
export const CAPITAL_CONFIRMATION_STALE_DAYS = 90;
export function isCapitalConfirmationStale(
  capitalToDeployEur: number | null, confirmedAt: string | null, nowIso: string,
): boolean {
  if (capitalToDeployEur == null) return false;
  if (!confirmedAt) return true;
  const staleBefore = new Date(nowIso).getTime() - CAPITAL_CONFIRMATION_STALE_DAYS * 86400000;
  return new Date(confirmedAt).getTime() < staleBefore;
}
