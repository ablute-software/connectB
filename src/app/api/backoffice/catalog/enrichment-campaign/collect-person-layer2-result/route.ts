// Prompt 274 — Layer 2 counterpart of collect-entity-layer1-result. Reads
// back cost + whether a hook actually got written (hook_status='researched'
// means a real read source backed it — see the worker's own no-hook-
// without-provenance rule; 'none_found' is a legitimate, honest outcome,
// not a failure).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { readJob } from '@/lib/enrichment-campaign';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { catalogPersonId, jobId } = await req.json().catch(() => ({})) as { catalogPersonId?: string; jobId?: string };
  if (!catalogPersonId || !jobId) return NextResponse.json({ ok: false, error: 'catalogPersonId and jobId required' }, { status: 400 });

  const job = await readJob(admin, jobId);
  let hookWritten = false;
  if (job.status === 'done') {
    const { data: person } = await admin.from('catalog_people').select('hook_status').eq('id', catalogPersonId).maybeSingle();
    hookWritten = person?.hook_status === 'researched';
  }

  return NextResponse.json({ ok: true, status: job.status, reason: job.reason, cost: job.cost, hookWritten });
}
