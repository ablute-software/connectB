// Real interaction-history import — commit. Founder's own session, RLS-
// scoped. TEMA A (contact facts) and TEMA B (private negotiation history)
// land in the SAME entities/interactions rows (they describe the same
// real-world relationship) — but only TEMA-A-field conflicts are ever
// queued to `contributions`; TEMA B facts (status, reopen_trigger,
// interaction content) NEVER become a contribution and NEVER touch the
// shared catalog. AI-proposed people mentions are separate and require
// the founder's explicit per-person confirmation before this call.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { matchPerson } from '@/lib/structured-import';
import type { MdImportPlan } from '@/lib/md-history-import';

const TEMA_A_FIELDS = new Set(['website', 'email_domain']);
// A section without a knowable date is still real history — this
// placeholder (pre-dating everything else in the pack) keeps it honestly
// distinguishable from "logged today" while satisfying the NOT NULL
// column; needs_review=true is the real signal to go fix the date.
const UNKNOWN_DATE_PLACEHOLDER = '2018-01-01T00:00:00.000Z';

interface ConfirmedPerson { entityKey: string; name: string; role?: string }

export async function POST(req: Request) {
  const { batchId, plan, confirmedPeople } = await req.json() as {
    batchId?: string; plan?: MdImportPlan; confirmedPeople?: ConfirmedPerson[];
  };
  if (!batchId || !plan) return NextResponse.json({ ok: false, error: 'batchId and plan are required.' }, { status: 400 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: batch } = await sb.from('import_batches').select('org_id').eq('id', batchId).maybeSingle();
  if (!batch) return NextResponse.json({ ok: false, error: 'Batch not found (or not yours).' }, { status: 404 });
  const orgId = batch.org_id as string;

  const entityIdByKey = new Map<string, string>();
  const conflictRows: Record<string, unknown>[] = [];
  let entitiesCreated = 0, entitiesUpdated = 0;

  for (const item of plan.entities) {
    if (!item.include) continue;
    if (item.chosenId) {
      const { data: owned } = await sb.from('entities').select('id').eq('id', item.chosenId).eq('org_id', orgId).maybeSingle();
      if (!owned) return NextResponse.json({ ok: false, error: `Entity match ${item.chosenId} isn't in your org.` }, { status: 400 });
      if (Object.keys(item.patch).length) {
        const { error } = await sb.from('entities').update(item.patch).eq('id', item.chosenId);
        if (error) return NextResponse.json({ ok: false, error: `entity "${item.key}": ${error.message}` }, { status: 500 });
        entitiesUpdated++;
      }
      entityIdByKey.set(item.key, item.chosenId);
      for (const c of item.temaAConflicts) conflictRows.push({
        org_id: orgId, subject_type: 'entity', subject_id: item.chosenId, field: c.field, value: c.incoming,
        source: 'user', status: 'submitted',
        note: `History import conflict — existing: ${JSON.stringify(c.existing)} vs imported: ${JSON.stringify(c.incoming)}. Kept existing; verify and update if the import is more current.`,
      });
      // TEMA B conflicts are never a contribution — private, org-only. If the
      // founder wants to override, they edit the entity directly.
    } else {
      const { data: created, error } = await sb.from('entities').insert({
        org_id: orgId, name: item.key, type: 'vc', invests_in_geographies: [], sectors: [],
        submission_channel_type: 'unknown', hard_filter_status: 'not_applicable',
        status: (item.patch.status as string) ?? 'not_contacted',
        website: (item.patch.website as string) ?? null, email_domain: (item.patch.email_domain as string) ?? null,
        reopen_trigger: (item.patch.reopen_trigger as string) ?? null,
        contact_lock_until: (item.patch.contact_lock_until as string) ?? null,
      }).select('id').single();
      if (error) return NextResponse.json({ ok: false, error: `entity "${item.key}": ${error.message}` }, { status: 500 });
      entityIdByKey.set(item.key, created.id);
      entitiesCreated++;
    }

    if (item.aliases.length) {
      const entityId = entityIdByKey.get(item.key)!;
      const { error } = await sb.from('entity_aliases')
        .upsert(item.aliases.map((alias) => ({ entity_id: entityId, alias })), { onConflict: 'entity_id,alias', ignoreDuplicates: true });
      if (error) return NextResponse.json({ ok: false, error: `aliases for "${item.key}": ${error.message}` }, { status: 500 });
    }
  }

  let interactionsCreated = 0, interactionsSkipped = 0;
  const interactionRows: Record<string, unknown>[] = [];
  for (const item of plan.interactions) {
    if (!item.include || item.status !== 'new') { interactionsSkipped++; continue; }
    const entityId = entityIdByKey.get(item.entityKey);
    if (!entityId) { interactionsSkipped++; continue; }
    interactionRows.push({
      org_id: orgId, entity_id: entityId, occurred_at: item.occurredAt ?? UNKNOWN_DATE_PLACEHOLDER,
      direction: item.direction, channel: item.channel, content: item.text,
      classification: estadoClassification(item.estado), pass_reason: item.estado === 'NÃO' ? item.text : null,
      needs_review: item.needsReview, source: 'import',
    });
  }
  if (interactionRows.length) {
    const { error } = await sb.from('interactions').insert(interactionRows);
    if (error) return NextResponse.json({ ok: false, error: `interactions: ${error.message}` }, { status: 500 });
    interactionsCreated = interactionRows.length;
  }

  let peopleCreated = 0;
  for (const cp of confirmedPeople ?? []) {
    const entityId = entityIdByKey.get(cp.entityKey);
    if (!entityId) continue;
    const { data: existingPeople } = await sb.from('people').select('id, full_name, linkedin_url, email_verified').eq('org_id', orgId).eq('entity_id', entityId);
    const { status } = matchPerson(existingPeople ?? [], { full_name: cp.name });
    if (status === 'matched') continue; // already known at this entity — nothing to add
    const { error } = await sb.from('people').insert({
      org_id: orgId, entity_id: entityId, full_name: cp.name, role: cp.role || null,
      seniority_rank: ((existingPeople ?? []).length || 0) + 1, linked_companies: [], linked_funds: [],
      hook_status: 'to_research', kill_words: [], preferred_language: 'pt',
      privacy_notice_sent: false, do_not_contact: false,
      data_source: 'AI-proposed from history import — unverified, confirm before outreach',
    });
    if (error) return NextResponse.json({ ok: false, error: `person "${cp.name}": ${error.message}` }, { status: 500 });
    peopleCreated++;
  }

  let conflictsQueued = 0;
  for (const row of conflictRows) {
    const { data: already } = await sb.from('contributions').select('id')
      .eq('org_id', orgId).eq('subject_type', row.subject_type as string).eq('subject_id', row.subject_id as string)
      .eq('field', row.field as string).eq('status', 'submitted').maybeSingle();
    if (already) continue;
    const { error } = await sb.from('contributions').insert(row);
    if (error) return NextResponse.json({ ok: false, error: `contributions (conflicts): ${error.message}` }, { status: 500 });
    conflictsQueued++;
  }

  await sb.from('import_batches').update({ status: 'committed', committed_at: new Date().toISOString() }).eq('id', batchId);

  return NextResponse.json({
    ok: true, entitiesCreated, entitiesUpdated, interactionsCreated, interactionsSkipped, peopleCreated, conflictsQueued,
  });
}

function estadoClassification(estado: string): string {
  if (estado === 'NÃO') return 'pass';
  if (estado === 'TALVEZ') return 'question';
  return 'awaiting';
}
