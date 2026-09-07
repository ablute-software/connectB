// BLOCO 3 — duplicate-cluster detection for the catalog merge tool
// (IRM_SPEC §9b-3). Read-only: proposes clusters, doesn't touch anything.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { findDuplicateClusters, pairKey } from '@/lib/catalog-dedupe';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [{ data: catalog, error }, { data: aliases }, { data: dismissals }] = await Promise.all([
    admin.from('catalog_entities').select('id, name, website, verification_status, created_at'),
    // Prompt 580 §A — entity_aliases holds BOTH catalog-scoped rows
    // (catalog_id set) and org-private rows (entity_id set, migration
    // 0017); this tool only ever means the catalog-scoped kind, and was
    // reading both. A null catalog_id can't spuriously union two real
    // catalog ids together (it's never a shared value, so it never had a
    // visible symptom) — real, but not a public-facing bug, so listed
    // above as diagnosed rather than as the 08/13 incident's own cause.
    admin.from('entity_aliases').select('catalog_id, alias').not('catalog_id', 'is', null),
    admin.from('catalog_dedupe_dismissals').select('a_catalog_id, b_catalog_id, status, reason, dismissed_by, dismissed_at'),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Prompt 580b §A.2 — 'not_same' pairs are real edges to REMOVE from the
  // graph (splits the group); 'uncertain' pairs stay in the group (no
  // edge removed) and are only looked up afterward, per-cluster, to
  // attach a label. Two separate maps because they do two separate things.
  const dismissedPairs = new Set<string>();
  const uncertainByPair = new Map<string, { reason: string | null; dismissedBy: string | null; dismissedAt: string }>();
  for (const d of dismissals ?? []) {
    const key = pairKey(d.a_catalog_id as string, d.b_catalog_id as string);
    if (d.status === 'uncertain') {
      uncertainByPair.set(key, { reason: d.reason as string | null, dismissedBy: d.dismissed_by as string | null, dismissedAt: d.dismissed_at as string });
    } else {
      dismissedPairs.add(key);
    }
  }

  const byId = new Map((catalog ?? []).map((c) => [c.id, c]));
  const clusters = findDuplicateClusters(catalog ?? [], aliases ?? [], dismissedPairs);

  // Prompt 580b §B — "0 deliveries · 0 packs · 0 aliases" for all five,
  // including btov (which really has 7 aliases and real deliveries):
  // the old code scoped its .in('catalog_id', candidateIds) to EVERY
  // catalog_entities row (763 of them) rather than just the ids actually
  // shown on screen. 763 UUIDs serialized into one .in() filter is a
  // ~28,000-character query string — confirmed against production before
  // writing this fix — well past any sane URL-length budget, so the
  // request came back empty (or failed) for every row uniformly, not just
  // btov. Scoping to only the ids appearing in a cluster (single/low
  // double digits in practice) is both the fix and, incidentally, a much
  // smaller query.
  const clusterIds = [...new Set(clusters.flatMap((cl) => cl.ids))];
  const [{ data: deliveryRows }, { data: packRows }, { data: aliasCountRows }] = clusterIds.length
    ? await Promise.all([
        admin.from('catalog_deliveries').select('catalog_id').in('catalog_id', clusterIds),
        admin.from('pack_items').select('catalog_id').in('catalog_id', clusterIds),
        admin.from('entity_aliases').select('catalog_id').not('catalog_id', 'is', null).in('catalog_id', clusterIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const countBy = (rows: { catalog_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.catalog_id, (m.get(r.catalog_id) ?? 0) + 1);
    return m;
  };
  const deliveriesById = countBy(deliveryRows as { catalog_id: string }[] | null);
  const packsById = countBy(packRows as { catalog_id: string }[] | null);
  const aliasesById = countBy(aliasCountRows as { catalog_id: string }[] | null);

  return NextResponse.json({
    ok: true,
    clusters: clusters.map((cl) => ({
      reasons: cl.reasons,
      matches: cl.matches,
      suspicious: cl.suspicious,
      // Prompt 580b §A.1/§A.2 — every pair within this (possibly just-
      // split, possibly still-whole) group that's marked uncertain, so
      // the UI can label "not sure" on the exact pair without the client
      // ever re-deriving pair keys itself.
      uncertainPairs: cl.ids.flatMap((a, i) => cl.ids.slice(i + 1).map((b) => {
        const info = uncertainByPair.get(pairKey(a, b));
        return info ? { a, b, ...info } : null;
      })).filter((x): x is NonNullable<typeof x> => x !== null),
      members: cl.ids.map((id) => byId.get(id)).filter(Boolean).map((m) => ({
        ...m,
        deliveries: deliveriesById.get(m!.id as string) ?? 0,
        packs: packsById.get(m!.id as string) ?? 0,
        aliasCount: aliasesById.get(m!.id as string) ?? 0,
      })),
    })),
  });
}
