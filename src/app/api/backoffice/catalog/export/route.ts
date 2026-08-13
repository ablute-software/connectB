// Prompt 187 §E — catalog_entities + their catalog_people contacts,
// flattened to one row per entity (a CSV has no notion of "two tabs" — the
// prompt's own text offers that as an alternative to one flattened file;
// this is the simpler of the two options it explicitly allows). Follows
// the established convention (toCsv, portal/export/route.ts) rather than
// inventing a second CSV-building approach.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { toCsv } from '@/lib/csv';

const COLUMNS = [
  'name', 'type', 'website', 'hq_city', 'hq_country', 'geographies', 'sectors',
  'stage_min', 'stage_max', 'check_min_eur', 'check_max_eur', 'thesis',
  'verification_status', 'source', 'contacts', 'created_at',
];

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [{ data: catalog, error }, { data: affiliations }] = await Promise.all([
    admin.from('catalog_entities').select('*').order('name', { ascending: true }),
    admin.from('catalog_person_affiliations').select('entity_id, title, catalog_people(full_name, linkedin_url)'),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const contactsByEntity = new Map<string, string[]>();
  for (const a of affiliations ?? []) {
    const person = a.catalog_people as unknown as { full_name: string; linkedin_url: string | null } | null;
    if (!person) continue;
    const label = `${person.full_name}${a.title ? ` (${a.title})` : ''}${person.linkedin_url ? ` <${person.linkedin_url}>` : ''}`;
    const entityId = a.entity_id as string;
    contactsByEntity.set(entityId, [...(contactsByEntity.get(entityId) ?? []), label]);
  }

  const rows = (catalog ?? []).map((c) => ({
    ...c,
    geographies: (c.geographies ?? []).join('; '),
    sectors: (c.sectors ?? []).join('; '),
    contacts: (contactsByEntity.get(c.id as string) ?? []).join('; '),
  }));

  const csv = toCsv(rows, COLUMNS);
  const filename = `sherlock-catalog-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"` },
  });
}
