// IRM_SPEC §9b — commits a (founder-reviewed, possibly edited) import plan
// from /dry-run. Founder's own session — RLS scopes every write to their
// own org. Field-level conflicts that were left unresolved become
// `contributions` rows (source='user') so they land in the existing
// back-office Fila → Contributions review queue instead of a bespoke
// "conflict inbox." Idempotent: re-submitting the same plan a second time
// re-matches everything as already-MATCHED/duplicate and changes nothing.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import type { ImportPlan } from '@/lib/structured-import';
import type { Channel, Classification, Direction } from '@/lib/types';

const VALID_CHANNELS: Channel[] = ['linkedin_dm', 'linkedin_note', 'email', 'web_form', 'call', 'meeting', 'event', 'intro'];
const VALID_CLASSIFICATIONS: Classification[] = ['awaiting', 'interested', 'meeting_request', 'question', 'pass', 'out_of_office', 'bounce', 'unclear'];

export async function POST(req: Request) {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { plan } = await req.json() as { plan?: ImportPlan };
  if (!plan) return NextResponse.json({ ok: false, error: 'plan is required.' }, { status: 400 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id;

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
      for (const c of item.conflicts) conflictRows.push({
        org_id: orgId, subject_type: 'entity', subject_id: item.chosenId, field: c.field, value: c.incoming,
        source: 'user', status: 'submitted',
        note: `§9b import conflict — existing: ${JSON.stringify(c.existing)} vs imported: ${JSON.stringify(c.incoming)}. Kept existing; verify and update if the import is more current.`,
      });
    } else {
      const r = item.csvRow;
      const { data: created, error } = await sb.from('entities').insert({
        org_id: orgId, name: r.name, type: r.type, hq_city: r.hq_city ?? null, hq_country: r.hq_country ?? null,
        invests_in_geographies: r.invests_in_geographies, website: r.website ?? null, website_verified: r.website_verified,
        email_domain: r.email_domain ?? null, email_domain_verified: r.email_domain_verified,
        submission_channel: r.submission_channel ?? null,
        stage_min: r.stage_min ?? null, stage_max: r.stage_max ?? null,
        check_min_eur: r.check_min_eur ?? null, check_max_eur: r.check_max_eur ?? null,
        sectors: r.sectors, hardware_stance: r.hardware_stance ?? null, is_sector_agnostic: r.is_sector_agnostic ?? null,
        thesis: r.thesis ?? null, fit_score: r.fit_score ?? null, wave: r.wave ?? null, our_angle: r.our_angle ?? null,
        hard_filter: r.hard_filter ?? null, hard_filter_status: r.hard_filter_status ?? 'not_applicable',
        status: r.status ?? 'not_contacted',
        last_verified: r.last_verified ?? null, source_url: r.source_url ?? null,
      }).select('id').single();
      if (error) return NextResponse.json({ ok: false, error: `entity "${item.key}": ${error.message}` }, { status: 500 });
      entityIdByKey.set(item.key, created.id);
      entitiesCreated++;
    }
  }

  const personIdByKey = new Map<string, string>();
  let peopleCreated = 0, peopleUpdated = 0, peopleSkipped = 0;

  for (const item of plan.people) {
    if (!item.include) continue;
    const entityId = entityIdByKey.get(item.entityKey);
    if (!entityId) { peopleSkipped++; continue; }

    if (item.chosenId) {
      const { data: owned } = await sb.from('people').select('id').eq('id', item.chosenId).eq('org_id', orgId).maybeSingle();
      if (!owned) return NextResponse.json({ ok: false, error: `Person match ${item.chosenId} isn't in your org.` }, { status: 400 });
      if (Object.keys(item.patch).length) {
        const { error } = await sb.from('people').update(item.patch).eq('id', item.chosenId);
        if (error) return NextResponse.json({ ok: false, error: `person "${item.key}": ${error.message}` }, { status: 500 });
        peopleUpdated++;
      }
      personIdByKey.set(item.key, item.chosenId);
      for (const c of item.conflicts) conflictRows.push({
        org_id: orgId, subject_type: 'person', subject_id: item.chosenId, field: c.field, value: c.incoming,
        source: 'user', status: 'submitted',
        note: `§9b import conflict — existing: ${JSON.stringify(c.existing)} vs imported: ${JSON.stringify(c.incoming)}. Kept existing; verify and update if the import is more current.`,
      });
    } else {
      const r = item.csvRow;
      const { data: created, error } = await sb.from('people').insert({
        org_id: orgId, entity_id: entityId, full_name: r.full_name, role: r.role ?? null,
        seniority_rank: r.seniority_rank, based_in: r.based_in ?? null,
        linkedin_url: r.linkedin_url ?? null, linkedin_verified: r.linkedin_verified,
        email_verified: r.email_verified ?? null, email_guess: r.email_verified ? null : (r.email_guess ?? null),
        email_source: r.email_source ?? null, background: r.background ?? null, personal_notes: r.notes ?? null,
        hook: r.hook ?? null, hook_status: r.hook_status ?? 'to_research', kill_words: r.kill_words,
        do_not_contact: r.do_not_contact,
      }).select('id').single();
      if (error) return NextResponse.json({ ok: false, error: `person "${item.key}": ${error.message}` }, { status: 500 });
      personIdByKey.set(item.key, created.id);
      peopleCreated++;
    }
  }

  let interactionsCreated = 0, interactionsSkipped = 0;
  const interactionRows: Record<string, unknown>[] = [];
  for (const item of plan.interactions) {
    if (!item.include || item.status !== 'new') { interactionsSkipped++; continue; }
    const entityId = entityIdByKey.get(item.entityKey);
    if (!entityId) { interactionsSkipped++; continue; }
    const personId = item.personKey ? personIdByKey.get(item.personKey) : undefined;
    const r = item.csvRow;
    const channel: Channel = VALID_CHANNELS.includes((r.channel ?? '') as Channel) ? (r.channel as Channel) : 'email';
    const direction: Direction = r.direction === 'in' ? 'in' : 'out';
    const classification: Classification | null = VALID_CLASSIFICATIONS.includes((r.classification ?? '') as Classification) ? (r.classification as Classification) : null;
    interactionRows.push({
      org_id: orgId, entity_id: entityId, person_id: personId ?? null,
      occurred_at: r.occurred_at ?? new Date().toISOString(), direction, channel, content: r.content,
      classification, pass_reason: r.pass_reason ?? null, next_action: r.next_action ?? null,
      next_action_due: r.next_action_due ?? null, source: 'import',
    });
  }
  if (interactionRows.length) {
    const { error } = await sb.from('interactions').insert(interactionRows);
    if (error) return NextResponse.json({ ok: false, error: `interactions: ${error.message}` }, { status: 500 });
    interactionsCreated = interactionRows.length;
  }

  let affiliationsCreated = 0;
  for (const a of plan.affiliations) {
    if (!a.include) continue;
    const personId = personIdByKey.get(a.personKey);
    if (!personId) continue;
    const entityId = a.entityKey ? entityIdByKey.get(a.entityKey) : undefined;
    const { error } = await sb.from('person_affiliations').insert({
      org_id: orgId, person_id: personId, entity_id: entityId ?? null, title: a.title ?? null,
      kind: a.kind, current: true, seniority_rank: a.seniorityRank ?? null, is_primary: a.isPrimary, notes: a.notes,
    });
    if (error) return NextResponse.json({ ok: false, error: `affiliation for "${a.personKey}": ${error.message}` }, { status: 500 });
    affiliationsCreated++;
  }

  if (conflictRows.length) {
    const { error } = await sb.from('contributions').insert(conflictRows);
    if (error) return NextResponse.json({ ok: false, error: `contributions (conflicts): ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true, entitiesCreated, entitiesUpdated, peopleCreated, peopleUpdated, peopleSkipped,
    interactionsCreated, interactionsSkipped, affiliationsCreated, conflictsQueued: conflictRows.length,
  });
}
