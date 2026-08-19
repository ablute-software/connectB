// Prompt 274 — Layer 2 (hook research) counterpart of enqueue-entity-layer1.
// One catalog_people.id, not one catalog_entities.id — Layer 2 is per-
// person (confirmed by reading the worker directly), so the campaign loop
// calls this once per person a just-finished Layer 1 pass surfaced.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { enqueueJob } from '@/lib/enrichment-campaign';
import { logAdminAction } from '@/lib/audit';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { catalogPersonId } = await req.json().catch(() => ({})) as { catalogPersonId?: string };
  if (!catalogPersonId) return NextResponse.json({ ok: false, error: 'catalogPersonId required' }, { status: 400 });

  const { data: person, error: personErr } = await admin.from('catalog_people')
    .select('hook_status, entity_id, catalog_entities(is_test)').eq('id', catalogPersonId).maybeSingle();
  if (personErr) return NextResponse.json({ ok: false, error: personErr.message }, { status: 500 });
  if (!person) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  const entityIsTest = (person.catalog_entities as unknown as { is_test: boolean } | null)?.is_test ?? false;
  if (entityIsTest || person.hook_status !== 'to_research') {
    return NextResponse.json({ ok: true, skip: true, reason: entityIsTest ? 'is_test entity' : `hook_status is '${person.hook_status}', not 'to_research'` });
  }

  const { jobId, alreadyQueued } = await enqueueJob(admin, 'person', catalogPersonId, 2);
  await logAdminAction(admin, { adminUserId: userId, action: 'enrichment_campaign_enqueue', subjectType: 'catalog_person', subjectId: catalogPersonId, detail: { layer: 2, jobId, alreadyQueued } });
  return NextResponse.json({ ok: true, skip: false, jobId, alreadyQueued });
}
