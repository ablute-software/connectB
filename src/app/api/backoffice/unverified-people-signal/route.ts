// Batch 2 item 3 — cross-org existence signal for unverified quick-created
// people. Platform-admin only, cross-org (same shape as
// /api/backoffice/research), but the response is AGGREGATE ONLY: counts and
// the proposed fields, never org identities or interaction content — same
// privacy discipline as Startups/Métricas. Only clusters reported by
// CROSS_ORG_REPORT_THRESHOLD or more distinct orgs are ever included, so
// with today's single-org reality this always returns an empty list —
// correct, not a placeholder; there is genuinely nothing to surface yet.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { clusterUnverifiedReports, shouldSurfaceCluster, type UnverifiedPersonReport } from '@/lib/person-similarity';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const role = await resolveRole(user.id, user.email, sb);
  if (role !== 'developer') return NextResponse.json({ ok: false, error: 'Not authorized.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: people, error } = await admin.from('people').select('id, org_id, full_name, entity_id').eq('identity_verified', false);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!people?.length) return NextResponse.json({ ok: true, clusters: [] });

  const entityIds = [...new Set(people.map((p) => p.entity_id).filter(Boolean))];
  const { data: entities } = entityIds.length
    ? await admin.from('entities').select('id, name').in('id', entityIds)
    : { data: [] as { id: string; name: string }[] };
  const entityNameById = new Map((entities ?? []).map((e) => [e.id as string, e.name as string]));

  const reports: UnverifiedPersonReport[] = people.map((p) => ({
    orgId: p.org_id as string, personId: p.id as string, fullName: p.full_name as string,
    context: entityNameById.get(p.entity_id as string) ?? '',
  }));

  const clusters = clusterUnverifiedReports(reports).filter((c) => shouldSurfaceCluster(c));

  return NextResponse.json({
    ok: true,
    clusters: clusters.map((c) => ({
      orgCount: c.reportOrgIds.size, sampleFullName: c.sampleFullName, sampleContext: c.sampleContext,
    })),
  });
}
