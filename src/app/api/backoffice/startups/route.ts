// BLOCO 3 — org health list. Aggregates ONLY: counts and timestamps, never
// entity/person names, interaction content, or pipeline stage — "nós não
// lemos o teu pipeline." No route exists to drill into an org's own data
// from here, and there's no impersonation anywhere in this console.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const weekAgo = new Date(Date.now() - WEEK_MS).toISOString();

  const [{ data: orgs, error }, { data: members }, { data: recentInteractions }, { data: grants }] = await Promise.all([
    admin.from('orgs').select('id, name, plan, created_at'),
    admin.from('org_members').select('org_id, user_id'),
    admin.from('interactions').select('org_id').gte('occurred_at', weekAgo),
    admin.from('access_grants').select('org_id').is('revoked_at', null),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const memberCountByOrg = new Map<string, number>();
  const userIdsByOrg = new Map<string, string[]>();
  for (const m of members ?? []) {
    memberCountByOrg.set(m.org_id, (memberCountByOrg.get(m.org_id) ?? 0) + 1);
    userIdsByOrg.set(m.org_id, [...(userIdsByOrg.get(m.org_id) ?? []), m.user_id]);
  }
  const interactionCountByOrg = new Map<string, number>();
  for (const i of recentInteractions ?? []) interactionCountByOrg.set(i.org_id, (interactionCountByOrg.get(i.org_id) ?? 0) + 1);
  const grantCountByOrg = new Map<string, number>();
  for (const g of grants ?? []) grantCountByOrg.set(g.org_id, (grantCountByOrg.get(g.org_id) ?? 0) + 1);

  // last_sign_in_at lives on auth.users, not queryable via a join — one
  // bulk listUsers() call, then take the max across each org's members.
  const lastSignInByUser = new Map<string, string | null>();
  let page = 1;
  for (;;) {
    const { data, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) break;
    for (const u of data.users) lastSignInByUser.set(u.id, u.last_sign_in_at ?? null);
    if (data.users.length < 200) break;
    page++;
  }

  const result = (orgs ?? []).map((org) => {
    const userIds = userIdsByOrg.get(org.id) ?? [];
    const lastLogins = userIds.map((id) => lastSignInByUser.get(id)).filter(Boolean) as string[];
    const lastLogin = lastLogins.length ? lastLogins.sort().at(-1)! : null;
    const interactionsThisWeek = interactionCountByOrg.get(org.id) ?? 0;
    const daysSinceLogin = lastLogin ? (Date.now() - new Date(lastLogin).getTime()) / (24 * 60 * 60 * 1000) : Infinity;
    const health: 'active' | 'quiet' | 'dormant' =
      interactionsThisWeek > 0 && daysSinceLogin < 14 ? 'active' : daysSinceLogin < 30 ? 'quiet' : 'dormant';

    return {
      orgId: org.id, name: org.name, plan: org.plan, createdAt: org.created_at,
      members: memberCountByOrg.get(org.id) ?? 0,
      grants: grantCountByOrg.get(org.id) ?? 0,
      interactionsThisWeek, lastLogin, health,
    };
  });

  return NextResponse.json({ ok: true, orgs: result });
}
