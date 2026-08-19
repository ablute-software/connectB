// Prompt 274 — step 3 of "run one entity" (after the browser's own direct
// call to the enrichment-worker Edge Function for step 2): reads back what
// the worker actually wrote for this job — status, cost (never present in
// the worker's own HTTP response, only in the enrichment_jobs row it
// updates), and which of the entity's people now need Layer 2 (hook
// research), so the campaign loop can queue those next.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { readJob } from '@/lib/enrichment-campaign';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { catalogEntityId, jobId } = await req.json().catch(() => ({})) as { catalogEntityId?: string; jobId?: string };
  if (!catalogEntityId || !jobId) return NextResponse.json({ ok: false, error: 'catalogEntityId and jobId required' }, { status: 400 });

  const job = await readJob(admin, jobId);

  // Only worth listing people-needing-Layer-2 once Layer 1 actually
  // finished ('done') — a still-queued (never claimed this invocation,
  // e.g. raced by another job) or failed/skipped job created no new
  // catalog_people rows to chase.
  const peopleNeedingLayer2: { id: string; fullName: string }[] = [];
  if (job.status === 'done') {
    const { data: affiliations } = await admin.from('catalog_person_affiliations')
      .select('person_id, catalog_people!inner(id, full_name, hook_status)')
      .eq('entity_id', catalogEntityId);
    const seen = new Set<string>();
    for (const a of affiliations ?? []) {
      const person = a.catalog_people as unknown as { id: string; full_name: string; hook_status: string };
      if (person.hook_status === 'to_research' && !seen.has(person.id)) {
        seen.add(person.id);
        peopleNeedingLayer2.push({ id: person.id, fullName: person.full_name });
      }
    }
  }

  return NextResponse.json({ ok: true, status: job.status, reason: job.reason, cost: job.cost, peopleNeedingLayer2 });
}
