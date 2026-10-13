// Contact & Support — the back-office ticket LIST, as pure(ish) logic over rows already read: the delay flags, the account of
// each ticket (Prompt 907 §B), the filters, the default order, the counts and the accounts the "account" filter offers.
// /api/backoffice/support is a thin wrapper around this; it lives here so a test (and the verification harness) can run
// exactly what the route runs over an in-memory database.
//
// Delay rules are computed at read time, not by a cron — cheap over a low-volume table, and the badges are always correct
// at the moment you look. Unchanged by Prompt 907; only `account`, the `account` filter and `accounts` are new.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ticketFlags } from './support-ticket-flags';
import { resolveTicketAccounts, type TicketAccount, type TicketAccountKind } from './support-ticket-account';

export interface SupportTicketRow {
  id: string; created_at: string; source: string; org_id: string | null; user_id: string | null;
  name: string; email: string; category: string; subject: string; message: string; context: string | null;
  status: string; priority: string; assigned_to: string | null;
  last_activity_at: string; first_response_at: string | null; resolved_at: string | null;
}

export interface TicketListFilters {
  status?: string | null; category?: string | null; source?: string | null;
  /** An org id or a firm id (the ticket's resolved account), or the literal `none` for tickets with no account. */
  account?: string | null;
}

export interface AccountOption { id: string; name: string; kind: TicketAccountKind; count: number }

export const NO_ACCOUNT_FILTER = 'none';

export async function buildSupportTicketList(admin: SupabaseClient, tickets: SupportTicketRow[], filters: TicketListFilters, now: number) {
  const accountOf = await resolveTicketAccounts(admin, tickets);
  const enriched = tickets.map((t) => ({
    ...t, ...ticketFlags(t, now),
    account: accountOf.get(t.id) as TicketAccount,
  }));

  const { status, category, source, account } = filters;
  const filtered = enriched.filter((t) =>
    (!status || t.status === status) && (!category || t.category === category) && (!source || t.source === source)
    && (!account || (account === NO_ACCOUNT_FILTER ? t.account.kind === 'none' : t.account.id === account)));

  // Default sort: overdue first (delayed new, then forgotten open), then
  // plain 'new', then everything else by oldest last_activity_at.
  filtered.sort((a, b) => {
    const rank = (t: typeof a) => (t.delayedNew || t.forgottenOpen ? 0 : t.status === 'new' ? 1 : 2);
    const ra = rank(a); const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return Date.parse(a.last_activity_at) - Date.parse(b.last_activity_at);
  });

  const atrasados = enriched.filter((t) => t.delayedNew).length;
  const esquecidos = enriched.filter((t) => t.forgottenOpen).length;
  const sugerirFechar = enriched.filter((t) => t.suggestClose).length;
  const newCount = enriched.filter((t) => t.status === 'new').length;
  // Nav badge: every ticket that needs a look right now — all 'new' ones
  // (delayed or not) plus 'open' ones that have gone quiet. Doesn't double
  // count: forgottenOpen is status='open', never 'new'.
  const navBadge = newCount + esquecidos;

  // What the account filter offers is built from ALL tickets, never from the filtered ones — otherwise picking an account
  // would make every other account vanish from the list you picked it from.
  const byAccount = new Map<string, AccountOption>();
  for (const t of enriched) {
    if (t.account.kind === 'none' || !t.account.id) continue;
    const seen = byAccount.get(t.account.id);
    if (seen) seen.count += 1;
    else byAccount.set(t.account.id, { id: t.account.id, name: t.account.name ?? '(unknown account)', kind: t.account.kind, count: 1 });
  }
  const accounts = [...byAccount.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const noAccount = enriched.filter((t) => t.account.kind === 'none').length;

  return {
    tickets: filtered,
    counts: { new: newCount, atrasados, esquecidos, sugerirFechar, navBadge },
    accounts, noAccount,
  };
}
