// Prompt 585 §G.3 — "Lista 'No-link verdicts' (org, alvo, data, reason_if_none)".
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: rowsRaw, error } = await admin.from('hook_suggestions')
    .select('id, target_kind, target_id, entity_id, channel, reason_if_none, created_at, orgs(name), catalog_entities(name)')
    .eq('verdict', 'none').order('created_at', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const personIds = Array.from(new Set((rowsRaw ?? []).filter((r) => r.target_kind === 'person').map((r) => r.target_id as string)));
  const { data: peopleRaw } = personIds.length
    ? await admin.from('catalog_people').select('id, full_name').in('id', personIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameByPersonId = new Map((peopleRaw ?? []).map((p) => [p.id as string, p.full_name as string]));

  const rows = (rowsRaw ?? []).map((r) => {
    const org = r.orgs as unknown as { name: string } | { name: string }[] | null;
    const entity = r.catalog_entities as unknown as { name: string } | { name: string }[] | null;
    const entityName = (Array.isArray(entity) ? entity[0] : entity)?.name ?? '(unknown fund)';
    return {
      id: r.id as string, channel: r.channel as string, createdAt: r.created_at as string,
      reasonIfNone: r.reason_if_none as string | null,
      orgName: (Array.isArray(org) ? org[0] : org)?.name ?? '(unknown org)',
      target: r.target_kind === 'person' ? (nameByPersonId.get(r.target_id as string) ?? '(deleted person)') : entityName,
      entityName,
    };
  });

  return NextResponse.json({ ok: true, rows });
}
