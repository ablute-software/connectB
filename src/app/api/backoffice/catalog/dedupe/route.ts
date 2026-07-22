// BLOCO 3 — duplicate-cluster detection for the catalog merge tool
// (IRM_SPEC §9b-3). Read-only: proposes clusters, doesn't touch anything.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { findDuplicateClusters } from '@/lib/catalog-dedupe';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [{ data: catalog, error }, { data: aliases }] = await Promise.all([
    admin.from('catalog_entities').select('id, name, website, verification_status, created_at'),
    admin.from('entity_aliases').select('catalog_id, alias'),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const byId = new Map((catalog ?? []).map((c) => [c.id, c]));
  const clusters = findDuplicateClusters(catalog ?? [], aliases ?? []);

  return NextResponse.json({
    ok: true,
    clusters: clusters.map((cl) => ({
      reasons: cl.reasons,
      members: cl.ids.map((id) => byId.get(id)).filter(Boolean),
    })),
  });
}
