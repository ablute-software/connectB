// Prompt 572 §D — read-only ranking for the new Insight › Contributions page
// (BackofficeShell's 'insight-contrib-by-user' placeholder). Two tables:
// `contributions` (proposed/accepted/rate/last-contribution — one row per
// author, per §C.1's own fix that made author_user_id reliable going
// forward) and `contribution_points` (the points column, migration 0289 —
// currently unpopulated in production, see the zero-rows note below).
//
// Only source='user' rows go into the per-person ranking: an AI-authored row
// (author_system, no author_user_id) was never a person "proposing" a fact,
// so folding it into a human leaderboard would be attributing someone else's
// work. AI volume is surfaced as its own summary line instead. Rows that
// predate the provenance fix (source='user', author_user_id null) are real
// human contributions with no recoverable author — never guessed at, shown
// as one aggregate "before the fix" line instead of silently vanishing.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

function displayName(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined): string {
  if (!user) return 'Unknown user';
  const fullName = user.user_metadata?.full_name;
  if (typeof fullName === 'string' && fullName.trim()) return fullName.trim();
  return user.email ?? 'Unknown user';
}

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [{ data: contributions, error: cErr }, { data: points, error: pErr }, { data: orgs, error: oErr }] = await Promise.all([
    admin.from('contributions').select('author_user_id, org_id, status, source, created_at'),
    admin.from('contribution_points').select('awarded_to_user_id, points'),
    admin.from('orgs').select('id, name'),
  ]);
  if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });
  if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });
  if (oErr) return NextResponse.json({ ok: false, error: oErr.message }, { status: 500 });

  const orgName = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  const pointsByUser = new Map<string, number>();
  for (const p of points ?? []) {
    if (!p.awarded_to_user_id) continue;
    pointsByUser.set(p.awarded_to_user_id, (pointsByUser.get(p.awarded_to_user_id) ?? 0) + p.points);
  }

  const aiRows = (contributions ?? []).filter((c) => c.source === 'ai');
  const userRows = (contributions ?? []).filter((c) => c.source === 'user');
  const attributed = userRows.filter((c) => c.author_user_id);
  const legacyUnattributed = userRows.filter((c) => !c.author_user_id);

  type PerUser = { proposed: number; accepted: number; lastAt: string; orgIds: Set<string> };
  const byUser = new Map<string, PerUser>();
  for (const c of attributed) {
    const id = c.author_user_id as string;
    const row = byUser.get(id) ?? { proposed: 0, accepted: 0, lastAt: c.created_at, orgIds: new Set() };
    row.proposed += 1;
    if (c.status === 'verified') row.accepted += 1;
    if (c.created_at > row.lastAt) row.lastAt = c.created_at;
    if (c.org_id) row.orgIds.add(c.org_id);
    byUser.set(id, row);
  }

  const resolvedUsers = await Promise.all([...byUser.keys()].map(async (id) => {
    const { data } = await admin.auth.admin.getUserById(id);
    return [id, displayName(data?.user)] as const;
  }));
  const nameById = new Map(resolvedUsers);

  const ranking = [...byUser.entries()]
    .map(([userId, row]) => ({
      userId,
      name: nameById.get(userId) ?? 'Unknown user',
      orgNames: [...row.orgIds].map((id) => orgName.get(id) ?? '(unknown org)').sort(),
      proposed: row.proposed,
      accepted: row.accepted,
      rate: row.proposed > 0 ? row.accepted / row.proposed : 0,
      points: pointsByUser.get(userId) ?? 0,
      lastContributionAt: row.lastAt,
    }))
    .sort((a, b) => (b.points - a.points) || (b.accepted - a.accepted) || (b.proposed - a.proposed));

  const legacyLastAt = legacyUnattributed.reduce<string | null>((max, c) => (!max || c.created_at > max ? c.created_at : max), null);
  // Migration 0318 shipped 2026-09-05 — the fix date is the boundary between
  // "could have been attributed and wasn't" and "predates the mechanism".
  const PROVENANCE_FIX_DATE = '2026-09-05';

  return NextResponse.json({
    ok: true,
    ranking,
    aiContributionCount: aiRows.length,
    legacyUnattributedCount: legacyUnattributed.length,
    legacyUnattributedLastAt: legacyLastAt,
    provenanceFixDate: PROVENANCE_FIX_DATE,
    pointsTableEmpty: (points ?? []).length === 0,
  });
}
