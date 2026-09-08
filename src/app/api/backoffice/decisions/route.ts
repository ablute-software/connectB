// Prompt 852 §F — the back-office's view of both directions of "no".
//
//   kind=startup — every startup_investor_decisions row (migration 0340):
//     the STARTUP's own "not a fit for us" against an investor.
//   kind=passes  — every investor-side pass: the classification='pass'
//     interaction plus the entity's own reopen_trigger ("what's needed").
//
// FOUNDER-PRIVATE, IN THE OTHER DIRECTION. CLAUDE.md's root rule forbids
// founder-private performance data reaching investor surfaces; this route is
// the mirror obligation. NOTHING here may be surfaced to any investor, ever
// — not a note, not its existence, not a count. There is no investor-facing
// reader of this route, and there must never be one: it is service-role,
// is_platform_admin-gated, and its output is shaped for a back-office table
// and nothing else. A pass reason is the investor's own words about a
// founder, and the founder's decision is their private judgement of an
// investor; neither belongs anywhere near the other party's screen.
//
// Reverted decisions are RETURNED, not hidden — the table renders them
// struck through with the revert date. A record that quietly disappears when
// undone is a worse audit trail than one that shows what happened.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 50;

export interface DecisionRow {
  id: string;
  startupName: string;
  investorName: string;
  date: string;
  reason: string | null;
  note: string;
  /** kind=passes only: entities.reopen_trigger. */
  whatsNeeded?: string | null;
  founderName: string;
  founderEmail: string;
  revertedAt?: string | null;
}

// Name AND email — that is the point of the column when several members
// share one account, which is the case this was asked for.
async function resolveUsers(admin: SupabaseClient, userIds: string[]) {
  const unique = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, { name: string; email: string }>();
  await Promise.all(unique.map(async (id) => {
    const { data } = await admin.auth.admin.getUserById(id);
    const u = data?.user;
    if (!u) return;
    const fullName = u.user_metadata?.full_name;
    out.set(id, {
      name: typeof fullName === 'string' && fullName.trim() ? fullName.trim() : (u.email ?? 'Unknown user'),
      email: u.email ?? '',
    });
  }));
  return out;
}

function matchesText(haystack: string | null | undefined, needle: string | null): boolean {
  if (!needle) return true;
  return (haystack ?? '').toLowerCase().includes(needle.toLowerCase());
}

function toCsv(rows: DecisionRow[], includeWhatsNeeded: boolean): string {
  const headers = ['startup', 'investor', 'date', 'reason', 'note',
    ...(includeWhatsNeeded ? ['whats_needed'] : []), 'founder', 'founder_email', 'reverted_at'];
  const esc = (v: string | null | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [
    r.startupName, r.investorName, r.date, r.reason, r.note,
    ...(includeWhatsNeeded ? [r.whatsNeeded ?? ''] : []),
    r.founderName, r.founderEmail, r.revertedAt ?? '',
  ].map(esc).join(','));
  return [headers.join(','), ...lines].join('\n');
}

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') === 'passes' ? 'passes' : 'startup';
  const startup = url.searchParams.get('startup');
  const investor = url.searchParams.get('investor');
  const founder = url.searchParams.get('founder');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0);
  const wantsCsv = url.searchParams.get('format') === 'csv';

  // Both shapes need the same two name lookups, so they are fetched once
  // here rather than per row: a few hundred orgs and a few thousand
  // entities at current scale, and the alternative is N round trips.
  const [{ data: orgs }, { data: entities }] = await Promise.all([
    admin.from('orgs').select('id, name'),
    admin.from('entities').select('id, name, org_id, reopen_trigger'),
  ]);
  const orgName = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  const entityById = new Map((entities ?? []).map((e) => [e.id as string, e as {
    id: string; name: string; org_id: string; reopen_trigger: string | null;
  }]));

  let rows: DecisionRow[] = [];

  if (kind === 'startup') {
    const { data, error } = await admin.from('startup_investor_decisions')
      .select('*').order('decided_at', { ascending: false });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    const users = await resolveUsers(admin, (data ?? []).map((d) => d.decided_by as string));
    rows = (data ?? []).map((d) => {
      const user = users.get(d.decided_by as string);
      return {
        id: d.id as string,
        startupName: orgName.get(d.org_id as string) ?? 'Unknown startup',
        investorName: entityById.get(d.entity_id as string)?.name ?? 'Unknown investor',
        date: d.decided_at as string,
        reason: (d.reason_category as string | null) ?? null,
        note: d.note as string,
        founderName: user?.name ?? 'Unknown user',
        founderEmail: user?.email ?? '',
        revertedAt: (d.reverted_at as string | null) ?? null,
      };
    });
  } else {
    // The investor-side pass: the interaction carries the reason, the entity
    // carries what would restart it. classified_by is who recorded it —
    // null on rows that predate that column, shown as such rather than
    // attributed to whoever happens to be looking.
    const { data, error } = await admin.from('interactions')
      .select('id, entity_id, org_id, occurred_at, pass_reason, pass_reason_category, classified_by, reverted_at')
      .eq('classification', 'pass').order('occurred_at', { ascending: false });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    const users = await resolveUsers(admin, (data ?? []).map((i) => i.classified_by as string));
    rows = (data ?? []).map((i) => {
      const entity = entityById.get(i.entity_id as string);
      const user = i.classified_by ? users.get(i.classified_by as string) : undefined;
      return {
        id: i.id as string,
        startupName: orgName.get(i.org_id as string) ?? 'Unknown startup',
        investorName: entity?.name ?? 'Unknown investor',
        date: i.occurred_at as string,
        reason: (i.pass_reason_category as string | null) ?? null,
        note: (i.pass_reason as string | null) ?? '',
        whatsNeeded: entity?.reopen_trigger ?? null,
        founderName: user?.name ?? 'Not recorded',
        founderEmail: user?.email ?? '',
        // Prompt 853 §2d — the revert audit trail applies to a pass row the
        // same way it already applies to kind=startup, above.
        revertedAt: (i.reverted_at as string | null) ?? null,
      };
    });
  }

  // Server-side, every filter — the client never receives rows it then hides.
  rows = rows.filter((r) =>
    matchesText(r.startupName, startup)
    && matchesText(r.investorName, investor)
    && (!founder || matchesText(r.founderName, founder) || matchesText(r.founderEmail, founder))
    && (!from || r.date >= from)
    // `to` is a calendar day; compare against its end so the day itself is
    // included rather than silently excluded at 00:00.
    && (!to || r.date <= `${to}T23:59:59.999Z`));

  if (wantsCsv) {
    return new NextResponse(toCsv(rows, kind === 'passes'), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${kind === 'passes' ? 'passes-over' : 'startup-decisions'}.csv"`,
      },
    });
  }

  const total = rows.length;
  return NextResponse.json({
    ok: true,
    rows: rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    total,
    page,
    pageSize: PAGE_SIZE,
    hasMore: (page + 1) * PAGE_SIZE < total,
  });
}
