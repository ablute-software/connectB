// BLOCO 3 — platform-wide aggregate counts + the audit log tail. Counts
// only, same "não lemos o teu pipeline" boundary as Startups.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const weekAgo = new Date(Date.now() - WEEK_MS).toISOString();

  const [
    { count: totalOrgs },
    { data: recentInteractions },
    { count: contributionsThisWeek },
    { count: totalUnlocks },
    { count: emailsThisWeek },
    { count: failedAutomationsThisWeek },
    { data: auditLog },
  ] = await Promise.all([
    admin.from('orgs').select('id', { count: 'exact', head: true }),
    admin.from('interactions').select('org_id').gte('occurred_at', weekAgo),
    admin.from('contributions').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    admin.from('pack_unlocks').select('id', { count: 'exact', head: true }),
    admin.from('interactions').select('id', { count: 'exact', head: true }).eq('channel', 'email').eq('direction', 'out').gte('occurred_at', weekAgo),
    admin.from('automation_runs').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', weekAgo),
    admin.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(50),
  ]);

  const activeOrgIds = new Set((recentInteractions ?? []).map((i) => i.org_id));

  return NextResponse.json({
    ok: true,
    metrics: {
      totalOrgs: totalOrgs ?? 0,
      activeOrgsThisWeek: activeOrgIds.size,
      contributionsThisWeek: contributionsThisWeek ?? 0,
      totalUnlocks: totalUnlocks ?? 0,
      emailsThisWeek: emailsThisWeek ?? 0,
      failedAutomationsThisWeek: failedAutomationsThisWeek ?? 0,
    },
    auditLog: auditLog ?? [],
  });
}
