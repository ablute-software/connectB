// Contact & Support — back-office "Assistência ao Cliente" list. Platform
// admin only. Delay rules are computed here at read time, not by a cron —
// cheap enough over a low-volume ticket table, and it means the badges are
// always correct at the moment you look, never stale from a missed run.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface Ticket {
  id: string; created_at: string; source: string; org_id: string | null; user_id: string | null;
  name: string; email: string; category: string; subject: string; message: string; context: string | null;
  status: string; priority: string; assigned_to: string | null;
  last_activity_at: string; first_response_at: string | null; resolved_at: string | null;
}

function flags(t: Ticket, now: number) {
  const delayedNew = t.status === 'new' && !t.first_response_at && now - Date.parse(t.created_at) > DAY;
  const forgottenOpen = t.status === 'open' && now - Date.parse(t.last_activity_at) > 3 * DAY;
  const suggestClose = t.status === 'waiting_user' && now - Date.parse(t.last_activity_at) > 7 * DAY;
  return { delayedNew, forgottenOpen, suggestClose };
}

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: tickets, error } = await admin.from('support_tickets').select('*').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const now = Date.now();
  const enriched = (tickets as Ticket[]).map((t) => ({ ...t, ...flags(t, now) }));

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const category = searchParams.get('category');
  const source = searchParams.get('source');
  const filtered = enriched.filter((t) =>
    (!status || t.status === status) && (!category || t.category === category) && (!source || t.source === source));

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

  return NextResponse.json({
    ok: true, tickets: filtered,
    counts: { new: newCount, atrasados, esquecidos, sugerirFechar, navBadge },
  });
}
