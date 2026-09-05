// BLOCO 3 — duplicate-cluster detection for the catalog merge tool
// (IRM_SPEC §9b-3). Read-only: proposes clusters, doesn't touch anything.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { findDuplicateClusters } from '@/lib/catalog-dedupe';

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
    admin.from('catalog_dedupe_dismissals').select('a_catalog_id, b_catalog_id'),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const byId = new Map((catalog ?? []).map((c) => [c.id, c]));
  const dismissedPairs = new Set((dismissals ?? []).map((d) => `${d.a_catalog_id}:${d.b_catalog_id}`));
  const isPairDismissed = (a: string, b: string) => {
    const [x, y] = [a, b].sort();
    return dismissedPairs.has(`${x}:${y}`);
  };

  // Prompt 580 §B.2/§B.3 — the pre-selected keeper favors verified, then
  // whichever candidate has more real-world weight already attached to it
  // (deliveries = founder pipelines carrying it, packs, aliases); the same
  // three counts are what the confirm panel's cascade preview states for
  // whichever candidates end up as losers. All three tables are exactly
  // what merge/route.ts itself repoints or deletes — nothing here counts
  // anything that route doesn't actually touch.
  const candidateIds = (catalog ?? []).map((c) => c.id as string);
  const [{ data: deliveryRows }, { data: packRows }, { data: aliasCountRows }] = candidateIds.length
    ? await Promise.all([
        admin.from('catalog_deliveries').select('catalog_id').in('catalog_id', candidateIds),
        admin.from('pack_items').select('catalog_id').in('catalog_id', candidateIds),
        admin.from('entity_aliases').select('catalog_id').not('catalog_id', 'is', null).in('catalog_id', candidateIds),
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

  const clusters = findDuplicateClusters(catalog ?? [], aliases ?? [])
    // Prompt 580 §B.1 — a cluster stays hidden only while EVERY pair within
    // it has been explicitly dismissed; if the data later ties one of
    // these ids to something new, at least one pair is undismissed and the
    // (possibly reshaped) cluster reappears on its own.
    .filter((cl) => {
      for (let i = 0; i < cl.ids.length; i++) {
        for (let j = i + 1; j < cl.ids.length; j++) {
          if (!isPairDismissed(cl.ids[i], cl.ids[j])) return true;
        }
      }
      return false;
    });

  return NextResponse.json({
    ok: true,
    clusters: clusters.map((cl) => ({
      reasons: cl.reasons,
      matches: cl.matches,
      suspicious: cl.suspicious,
      members: cl.ids.map((id) => byId.get(id)).filter(Boolean).map((m) => ({
        ...m,
        deliveries: deliveriesById.get(m!.id as string) ?? 0,
        packs: packsById.get(m!.id as string) ?? 0,
        aliasCount: aliasesById.get(m!.id as string) ?? 0,
      })),
    })),
  });
}
