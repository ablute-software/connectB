// Prompt 576 Fase 2 — extracted from /api/backoffice/support so Attention's
// "N tickets need a look" row cites the exact same definition of "needs a
// look" (delayed new, or gone-quiet open), never a second one.
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export interface TicketFlagInput { created_at: string; status: string; first_response_at: string | null; last_activity_at: string }

export function ticketFlags(t: TicketFlagInput, now: number) {
  const delayedNew = t.status === 'new' && !t.first_response_at && now - Date.parse(t.created_at) > DAY;
  const forgottenOpen = t.status === 'open' && now - Date.parse(t.last_activity_at) > 3 * DAY;
  const suggestClose = t.status === 'waiting_user' && now - Date.parse(t.last_activity_at) > 7 * DAY;
  return { delayedNew, forgottenOpen, suggestClose };
}

/** Same set /api/backoffice/support's navBadge counts: every ticket that needs a look right now. */
export function needsAttention(t: TicketFlagInput, now: number): boolean {
  if (t.status === 'new') return true;
  return ticketFlags(t, now).forgottenOpen;
}
