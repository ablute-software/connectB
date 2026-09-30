// Prompt I-01 §C.3 — Portfolio: live (non-ended) relationships through
// incubator_portfolio() (level-0 fields only: name always; sector/stage only
// while access is live), the pending invites and the cohorts. Opening the
// Portfolio is not a content consultation, so nothing is logged here.
import { NextResponse } from 'next/server';
import { requireIncubatorMember } from '@/lib/incubator-access';

// Per-user, per-request data: never prerendered (an env-less build would
// otherwise freeze the not-configured answer into a static file).
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireIncubatorMember();
  if ('error' in gate) return gate.error;
  const { sb, member } = gate;

  const [portfolio, invites, cohorts] = await Promise.all([
    sb.rpc('incubator_portfolio', { p_incubator_id: member.incubatorId }),
    sb.from('incubator_invites')
      .select('id, email, startup_name, sector, website, cohort_id, status, sent_at, last_sent_at, send_count, token_expires_at, created_at')
      .eq('incubator_id', member.incubatorId).in('status', ['invited', 'expired'])
      .order('created_at', { ascending: false }),
    sb.from('incubator_cohorts').select('id, name, starts_on, ends_on, archived_at')
      .eq('incubator_id', member.incubatorId).order('created_at', { ascending: false }),
  ]);
  if (portfolio.error) return NextResponse.json({ ok: false, error: portfolio.error.message }, { status: 500 });
  // An 'invited' row past its date reads as expired on screen, without a write.
  const now = Date.now();
  const pending = (invites.data ?? []).map((i) => ({
    ...i, status: i.status === 'invited' && new Date(i.token_expires_at).getTime() < now ? 'expired' : i.status,
  }));
  return NextResponse.json({ ok: true, relationships: portfolio.data ?? [], invites: pending, cohorts: cohorts.data ?? [] });
}
