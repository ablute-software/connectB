// Prompt 570 §D.3 — reconcile hand-added entities against the catalog.
//
// Idempotent by construction: the rules are a pure function
// (catalog-candidate-reconcile.ts) over the current rows, so running it twice
// writes the same thing twice. Safe to call by hand from the back-office and
// at the end of each delivery or import.
//
// Three things it must never do, and each is enforced here rather than
// promised:
//   * never write catalog_entities — this route only ever updates `entities`;
//   * never touch a row a human decided — merged/promoted/dismissed are
//     dropped inside reconcileCandidates and never reach an update;
//   * never write catalog_deliveries — see 0316's header. A delivery is an
//     event, read by quota and by the founder's pipeline; a reconciliation job
//     must not be able to hand someone an investor.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import {
  reconcileCandidates, summarize,
  type ReconcileCandidate, type ReconcileCatalogRow,
} from '@/lib/catalog-candidate-reconcile';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  // `ids` scopes the run to a selection (the §D.6 bulk action); absent means
  // every undecided candidate. `dryRun` reports without writing, which is what
  // makes it safe to look before running it against 751 rows.
  const { ids, dryRun } = await req.json().catch(() => ({})) as { ids?: string[]; dryRun?: boolean };

  let query = admin.from('entities')
    .select('id, name, website, catalog_review_status')
    .eq('source', 'manual')
    .in('catalog_review_status', ['pending', 'linked', 'probable_match']);
  if (ids?.length) query = query.in('id', ids);

  const [{ data: candidates, error: candErr }, { data: catalog, error: catErr }] = await Promise.all([
    query,
    admin.from('catalog_entities').select('id, name, website'),
  ]);
  if (candErr) return NextResponse.json({ ok: false, error: candErr.message }, { status: 500 });
  if (catErr) return NextResponse.json({ ok: false, error: catErr.message }, { status: 500 });

  const rows = (candidates ?? []) as ReconcileCandidate[];

  // The delivery link, read once for the whole batch. Used only to record a
  // correspondence we already know when no rule matched — never to create one.
  const { data: deliveries } = rows.length
    ? await admin.from('catalog_deliveries').select('entity_id, catalog_id').in('entity_id', rows.map((r) => r.id))
    : { data: [] as { entity_id: string; catalog_id: string }[] };
  const deliveredByEntity = new Map((deliveries ?? []).map((d) => [d.entity_id as string, d.catalog_id as string]));

  const before = rows.reduce((acc, r) => {
    const k = r.catalog_review_status ?? 'null';
    acc[k] = (acc[k] ?? 0) + 1; return acc;
  }, {} as Record<string, number>);

  const decisions = reconcileCandidates(
    rows.map((r) => ({ ...r, deliveredCatalogId: deliveredByEntity.get(r.id) ?? null })),
    (catalog ?? []) as ReconcileCatalogRow[],
  );

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, before, after: summarize(decisions), changed: 0 });
  }

  // Only rows whose status or catalog_id actually moves are written, so a
  // second run costs almost nothing and updated_at stays meaningful.
  const currentById = new Map(rows.map((r) => [r.id, r]));
  let changed = 0;
  for (const d of decisions) {
    const current = currentById.get(d.id);
    if (!current) continue;
    if (current.catalog_review_status === d.status) continue;
    const { error } = await admin.from('entities')
      .update({ catalog_review_status: d.status, catalog_id: d.catalogId })
      .eq('id', d.id)
      // Belt and braces against a concurrent human decision landing mid-run:
      // the row must still be undecided at the moment of the write.
      .in('catalog_review_status', ['pending', 'linked', 'probable_match']);
    if (error) return NextResponse.json({ ok: false, error: error.message, changed }, { status: 500 });
    changed += 1;
  }

  const after = summarize(decisions);
  await logAdminAction(admin, {
    adminUserId: userId, action: 'catalog_candidates_reconcile',
    subjectType: 'catalog_entity', subjectId: null,
    detail: { scope: ids?.length ? 'selection' : 'all', before, after, changed },
  });

  return NextResponse.json({ ok: true, before, after, changed });
}
