// Prompt 274 — counts + prioritized candidate list for the enrichment
// campaign panel. Read-only, no queue writes. is_test rows are excluded
// from every count (same "never counted in real business metrics"
// convention this codebase already applies everywhere else), so these
// numbers may not exactly match a raw `select count(*)` — that's
// intentional, not a bug.
//
// No aggregate view/RPC exists for any of these four counts (confirmed by
// reading the schema first) — 529 catalog_entities is a small enough table
// to fetch whole and count in-memory, same pattern api/backoffice/catalog
// already uses for aliases/contacts.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [{ data: entities, error: entitiesErr }, { data: deliveries }, { data: affiliations }] = await Promise.all([
    admin.from('catalog_entities')
      .select('id, name, verification_status, is_test, check_min_eur, check_max_eur, enrichment_status'),
    admin.from('catalog_deliveries').select('catalog_id'),
    admin.from('catalog_person_affiliations').select('entity_id, catalog_people(hook_status)'),
  ]);
  if (entitiesErr) return NextResponse.json({ ok: false, error: entitiesErr.message }, { status: 500 });

  const real = (entities ?? []).filter((e) => !e.is_test);

  const deliveredCount = new Map<string, number>();
  for (const d of deliveries ?? []) deliveredCount.set(d.catalog_id, (deliveredCount.get(d.catalog_id) ?? 0) + 1);

  const entitiesWithPeople = new Set<string>();
  const entitiesWithHooks = new Set<string>();
  for (const a of affiliations ?? []) {
    entitiesWithPeople.add(a.entity_id as string);
    const person = a.catalog_people as unknown as { hook_status: string } | null;
    if (person?.hook_status === 'researched') entitiesWithHooks.add(a.entity_id as string);
  }

  const counts = {
    total: real.length,
    pending: real.filter((e) => e.enrichment_status === 'pending').length,
    withCheckSize: real.filter((e) => e.check_min_eur != null || e.check_max_eur != null).length,
    withPeople: real.filter((e) => entitiesWithPeople.has(e.id)).length,
    withHooks: real.filter((e) => entitiesWithHooks.has(e.id)).length,
  };

  // Prompt 274 — priority substitute for "fit High first" (see
  // src/lib/enrichment-campaign.ts header for why fit_score isn't
  // available here): delivered-to-at-least-one-org first (these are the
  // rows a real founder is looking at right now with empty columns —
  // exactly the case that prompted this campaign), then verified over
  // pending (don't spend AI budget enriching unverified/junk rows), then
  // more deliveries = more founders affected, then name for a stable order.
  const candidates = real
    .filter((e) => e.enrichment_status === 'pending')
    .map((e) => ({ id: e.id, name: e.name, verified: e.verification_status === 'verified', deliveredCount: deliveredCount.get(e.id) ?? 0 }))
    .sort((a, b) =>
      (b.deliveredCount > 0 ? 1 : 0) - (a.deliveredCount > 0 ? 1 : 0)
      || (b.verified ? 1 : 0) - (a.verified ? 1 : 0)
      || b.deliveredCount - a.deliveredCount
      || a.name.localeCompare(b.name));

  return NextResponse.json({ ok: true, counts, candidates });
}
