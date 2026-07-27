// Prompt B — the internal truth about the investor catalogue. The public
// landing shows rounded-down bands (500+, 25+); this route shows the real
// numbers, for the platform team only. Read-only: it counts, it never writes.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  // head+count keeps every one of these a COUNT query rather than a fetch —
  // the catalogue is 500+ rows today and only grows.
  const countOf = async (build: (q: any) => any) => {
    const { count } = await build(admin.from('catalog_entities').select('id', { count: 'exact', head: true }));
    return count ?? 0;
  };

  const [total, verified, imported, demo, withPerson, withEmail, backfilled] = await Promise.all([
    countOf((q) => q),
    countOf((q) => q.eq('catalog_status', 'verified')),
    countOf((q) => q.eq('catalog_status', 'imported')),
    countOf((q) => q.eq('catalog_status', 'demo')),
    countOf((q) => q.not('key_people', 'is', null)),
    countOf((q) => q.not('email', 'is', null)),
    countOf((q) => q.not('source_entity_id', 'is', null)),
  ]);

  // Country breakdown: one paged read of just two columns. Counting per
  // country server-side would be one query per country — worse, not better.
  const countries = new Map<string, { total: number; verified: number }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('catalog_entities')
      .select('hq_country, catalog_status')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error || !data) break;
    for (const row of data) {
      const key = row.hq_country ?? '—';
      const bucket = countries.get(key) ?? { total: 0, verified: 0 };
      bucket.total += 1;
      if (row.catalog_status === 'verified') bucket.verified += 1;
      countries.set(key, bucket);
    }
    if (data.length < 1000) break;
  }
  const byCountry = [...countries.entries()]
    .map(([country, v]) => ({ country, ...v }))
    .sort((a, b) => b.verified - a.verified || b.total - a.total || a.country.localeCompare(b.country));

  // Packs + their sizes, and deliveries per org.
  const { data: packs } = await admin.from('packs').select('id, name, description, price_eur, active').order('name');
  const { data: items } = await admin.from('pack_items').select('pack_id');
  const itemCount = new Map<string, number>();
  for (const it of items ?? []) itemCount.set(it.pack_id, (itemCount.get(it.pack_id) ?? 0) + 1);

  const { data: deliveries } = await admin.from('catalog_deliveries').select('org_id, via_pack');
  const perOrg = new Map<string, { total: number; viaPack: number }>();
  for (const d of deliveries ?? []) {
    const bucket = perOrg.get(d.org_id) ?? { total: 0, viaPack: 0 };
    bucket.total += 1;
    if (d.via_pack) bucket.viaPack += 1;
    perOrg.set(d.org_id, bucket);
  }
  const { data: orgs } = await admin.from('orgs').select('id, name');
  const orgName = new Map((orgs ?? []).map((o) => [o.id, o.name]));

  return NextResponse.json({
    ok: true,
    totals: {
      total, verified, imported, demo, backfilled,
      withPerson, withEmail,
      // Share of the *packable* catalogue (demo rows never enter packs) that
      // has a named person — the number that decides whether a pack is
      // actually actionable for a founder.
      personPct: total - demo > 0 ? Math.round((withPerson / (total - demo)) * 100) : 0,
      countries: byCountry.filter((c) => c.country !== '—').length,
    },
    byCountry,
    packs: (packs ?? []).map((p) => ({ ...p, items: itemCount.get(p.id) ?? 0 })),
    deliveries: [...perOrg.entries()]
      .map(([orgId, v]) => ({ orgId, orgName: orgName.get(orgId) ?? orgId.slice(0, 8), ...v }))
      .sort((a, b) => b.total - a.total),
  });
}
