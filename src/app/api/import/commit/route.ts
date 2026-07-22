// IRM_SPEC §9c/§9d/§9e — commit a reviewed import batch: reconcile against
// the org's own existing entities/people (email exact > name match; the
// founder's own explicit "link to this existing record" choice always wins),
// create org-private records for anything unmatched, log interactions with
// import provenance, then derive each touched entity's stage/status from the
// resulting timeline (§9e). Uses the founder's own session (not service
// role) so RLS naturally scopes every read/write to their own org — nothing
// here can touch another org's data.
import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import type { Channel, Direction, Entity, Person } from '@/lib/types';

interface ApprovedEntity { name: string; website?: string; matchId?: string | null }
interface ApprovedPerson { name: string; role?: string; entity_name?: string; phones?: string[]; emails?: string[]; linkedin_url?: string; matchId?: string | null }
interface ApprovedInteraction { date?: string; channel?: string; direction: Direction; person_name?: string; entity_name?: string; summary: string; outcome?: string; followup_marker?: string }

const norm = (s: string) => s.trim().toLowerCase();
const VALID_CHANNELS: Channel[] = ['linkedin_dm', 'linkedin_note', 'email', 'web_form', 'call', 'meeting', 'event', 'intro'];

export async function POST(req: NextRequest) {
  const { batchId, approved } = await req.json() as {
    batchId: string;
    approved: { entities: ApprovedEntity[]; people: ApprovedPerson[]; interactions: ApprovedInteraction[] };
  };
  if (!batchId || !approved) return NextResponse.json({ ok: false, error: 'batchId and approved required' }, { status: 400 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: batch, error: batchErr } = await sb.from('import_batches').select('*').eq('id', batchId).maybeSingle();
  if (batchErr || !batch) return NextResponse.json({ ok: false, error: batchErr?.message ?? 'Batch not found (or not yours).' }, { status: 404 });
  const orgId = batch.org_id as string;

  const { data: existingEntities } = await sb.from('entities').select('*').eq('org_id', orgId);
  const { data: existingPeople } = await sb.from('people').select('*').eq('org_id', orgId);
  const entities = (existingEntities ?? []) as Entity[];
  const people = (existingPeople ?? []) as Person[];

  // ---- 1. entities ----
  const entityIdByName = new Map<string, string>();
  const newSubmissions: Record<string, unknown>[] = [];
  let entitiesCreated = 0;
  for (const e of approved.entities) {
    const key = norm(e.name);
    if (e.matchId) { entityIdByName.set(key, e.matchId); continue; }
    const existing = entities.find((x) => norm(x.name) === key);
    if (existing) { entityIdByName.set(key, existing.id); continue; }

    const { data: created, error } = await sb.from('entities').insert({
      org_id: orgId, name: e.name, type: 'vc', invests_in_geographies: [], website: e.website || null,
      website_verified: false, email_domain_verified: false, sectors: [],
      submission_channel_type: 'unknown', hard_filter_status: 'not_applicable', status: 'not_contacted',
    }).select().single();
    if (error) return NextResponse.json({ ok: false, error: `entity "${e.name}": ${error.message}` }, { status: 500 });
    entityIdByName.set(key, created.id);
    entitiesCreated++;
    newSubmissions.push({
      org_id: orgId, status: 'pending_review',
      payload: { name: e.name, type: 'vc', sectors: [], website: e.website || undefined, notes: `Discovered via history import (batch ${batchId}).` },
    });
  }
  if (newSubmissions.length) {
    const { error } = await sb.from('investor_submissions').insert(newSubmissions);
    if (error) return NextResponse.json({ ok: false, error: `investor_submissions: ${error.message}` }, { status: 500 });
  }

  // ---- 2. people ----
  const personIdByName = new Map<string, string>();
  const newPersonContribs: Record<string, unknown>[] = [];
  let peopleCreated = 0; let peopleSkipped = 0;
  for (const p of approved.people) {
    const key = norm(p.name);
    if (p.matchId) { personIdByName.set(key, p.matchId); continue; }
    const emailMatch = p.emails?.length
      ? people.find((x) => x.email_verified && p.emails!.some((em) => em.toLowerCase() === x.email_verified!.toLowerCase()))
      : undefined;
    const nameMatch = !emailMatch ? people.find((x) => norm(x.full_name) === key) : undefined;
    const match = emailMatch ?? nameMatch;
    if (match) { personIdByName.set(key, match.id); continue; }

    const entityId = p.entity_name ? entityIdByName.get(norm(p.entity_name)) : undefined;
    if (!entityId) { peopleSkipped++; continue; } // can't create a person with no resolvable entity

    const nextRank = people.filter((x) => x.entity_id === entityId).length + 1;
    const { data: created, error } = await sb.from('people').insert({
      org_id: orgId, entity_id: entityId, full_name: p.name, role: p.role || null, seniority_rank: nextRank,
      linkedin_url: p.linkedin_url || null, linkedin_verified: false, email_verified: p.emails?.[0] || null,
      bounce_count: 0, phone: p.phones?.[0] || null, linked_companies: [], linked_funds: [],
      hook_status: 'to_research', kill_words: [], preferred_language: 'en',
      privacy_notice_sent: false, do_not_contact: false,
    }).select().single();
    if (error) return NextResponse.json({ ok: false, error: `person "${p.name}": ${error.message}` }, { status: 500 });
    personIdByName.set(key, created.id);
    peopleCreated++;
    newPersonContribs.push({
      org_id: orgId, subject_type: 'person', subject_id: created.id, field: '__import_new_person__', value: true,
      note: `Imported from history batch ${batchId} — check for the same person under other orgs.`,
    });
  }
  if (newPersonContribs.length) {
    const { error } = await sb.from('contributions').insert(newPersonContribs);
    if (error) return NextResponse.json({ ok: false, error: `contributions: ${error.message}` }, { status: 500 });
  }

  // ---- 3. interactions ----
  const interactionRows: Record<string, unknown>[] = [];
  let interactionsSkipped = 0;
  for (const i of approved.interactions) {
    const entityId = i.entity_name ? entityIdByName.get(norm(i.entity_name)) : undefined;
    if (!entityId) { interactionsSkipped++; continue; }
    const personId = i.person_name ? personIdByName.get(norm(i.person_name)) : undefined;
    const channel: Channel = (VALID_CHANNELS as string[]).includes(i.channel ?? '') ? (i.channel as Channel) : 'email';
    interactionRows.push({
      org_id: orgId, entity_id: entityId, person_id: personId ?? null,
      occurred_at: i.date || new Date().toISOString(), direction: i.direction, channel,
      content: i.summary, source: 'import', import_batch_id: batchId,
      next_action: i.followup_marker || null,
    });
  }
  if (interactionRows.length) {
    const { error } = await sb.from('interactions').insert(interactionRows);
    if (error) return NextResponse.json({ ok: false, error: `interactions: ${error.message}` }, { status: 500 });
  }

  // ---- 4. post-import analysis (§9e): derive stage/status per touched entity ----
  const touchedEntityIds = [...new Set(interactionRows.map((r) => r.entity_id as string))];
  for (const entityId of touchedEntityIds) {
    const rows = interactionRows.filter((r) => r.entity_id === entityId)
      .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
    const hasInbound = rows.some((r) => r.direction === 'in');
    const hasMeeting = rows.some((r) => r.channel === 'meeting');
    const status = hasMeeting ? 'diligence' : hasInbound ? 'in_conversation' : 'contacted';
    const stage = hasMeeting ? 'meeting' : hasInbound ? 'engaged' : 'contacted';
    await sb.from('entities').update({ status }).eq('id', entityId);
    await sb.from('relationship_state').upsert({ org_id: orgId, entity_id: entityId, stage }, { onConflict: 'org_id,entity_id' });
  }

  await sb.from('import_batches').update({ status: 'committed', committed_at: new Date().toISOString() }).eq('id', batchId);

  return NextResponse.json({
    ok: true, entitiesCreated, peopleCreated, peopleSkipped,
    interactionsImported: interactionRows.length, interactionsSkipped,
  });
}
