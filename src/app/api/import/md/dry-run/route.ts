// Real interaction-history import — dry-run. Founder's own session, RLS-
// scoped (same posture as every other importer in this app). Read-only:
// builds the TEMA A (contact facts) / TEMA B (private history) plan,
// writes nothing.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { buildMdImportPlan, type MdSection } from '@/lib/md-history-import';

export async function POST(req: Request) {
  const { batchId } = await req.json() as { batchId?: string };
  if (!batchId) return NextResponse.json({ ok: false, error: 'batchId required' }, { status: 400 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: batch } = await sb.from('import_batches').select('org_id, extraction').eq('id', batchId).maybeSingle();
  if (!batch) return NextResponse.json({ ok: false, error: 'Batch not found (or not yours).' }, { status: 404 });

  const extraction = batch.extraction as { sections: MdSection[] } | null;
  if (!extraction?.sections) return NextResponse.json({ ok: false, error: 'Batch has not been extracted yet.' }, { status: 400 });

  const [{ data: entities, error: entErr }, { data: interactions, error: intErr }] = await Promise.all([
    sb.from('entities').select('*').eq('org_id', batch.org_id),
    sb.from('interactions').select('entity_id, occurred_at, content').eq('org_id', batch.org_id),
  ]);
  if (entErr || intErr) return NextResponse.json({ ok: false, error: (entErr ?? intErr)!.message }, { status: 500 });

  const plan = buildMdImportPlan(extraction.sections, { entities: entities ?? [], interactions: interactions ?? [] });
  return NextResponse.json({ ok: true, plan });
}
