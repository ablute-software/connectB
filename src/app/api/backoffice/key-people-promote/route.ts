// Prompt 264 — bulk version of Prompt 263's one-at-a-time "Add as contact":
// 248 entities (measured live in production before this prompt) have a
// verified `key_people` contribution; 239 of those still have zero rows in
// `people`. A per-dossier button doesn't reach that scale — this is the
// backoffice screen that does, for this org today and any future org that
// hits the same gap (per the prompt's own point 5: a reusable feature, not
// a one-off data fix — no raw SQL/migration touches real data here).
//
// Backoffice, not Settings: this is a bulk DATA-QUALITY action across
// (potentially) every org, the same shape as every other queue tab here
// (Contributions, Candidates, ...) — service-role reads, admin-only,
// review-then-apply. A founder-facing Settings screen would only ever see
// their own org; this needs the cross-org view a platform admin has.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { keyPeopleParseNeedsReview, parseKeyPeopleText } from '@/lib/key-people-parse';

async function adminGate() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return { error: NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 }) };

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  const role = await resolveRole(user.id, user.email, sb, user.email_confirmed_at);
  if (role !== 'developer') return { error: NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 }) };

  return { admin: createClient(url, service, { auth: { persistSession: false } }) };
}

// Shared by GET (preview) and POST (re-verified server-side before writing,
// never trusting the client's own view of which entities still qualify).
async function findCandidates(admin: SupabaseClient, entityIds?: string[]) {
  let contribQuery = admin.from('contributions').select('subject_id')
    .eq('subject_type', 'entity').eq('field', 'key_people').eq('status', 'verified');
  if (entityIds) contribQuery = contribQuery.in('subject_id', entityIds);
  const { data: contribRows } = await contribQuery;
  const candidateIds = [...new Set((contribRows ?? []).map((c) => c.subject_id as string))];
  if (candidateIds.length === 0) return [];

  const { data: entities } = await admin.from('entities').select('id, org_id, name, key_people').in('id', candidateIds);
  const withKeyPeople = (entities ?? []).filter((e) => !!e.key_people);
  if (withKeyPeople.length === 0) return [];

  const { data: peopleRows } = await admin.from('people').select('entity_id').in('entity_id', withKeyPeople.map((e) => e.id as string));
  const entitiesWithPeople = new Set((peopleRows ?? []).map((p) => p.entity_id as string));

  const { data: orgs } = await admin.from('orgs').select('id, name').in('id', [...new Set(withKeyPeople.map((e) => e.org_id as string))]);
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

  return withKeyPeople
    .filter((e) => !entitiesWithPeople.has(e.id as string))
    .map((e) => {
      const parsed = parseKeyPeopleText(e.key_people as string);
      return {
        entityId: e.id as string, entityName: e.name as string,
        orgId: e.org_id as string, orgName: orgNameById.get(e.org_id as string) ?? 'Unknown org',
        parsed, needsReview: keyPeopleParseNeedsReview(parsed),
      };
    });
}

export async function GET() {
  const gate = await adminGate();
  if (gate.error) return gate.error;
  const items = await findCandidates(gate.admin!);
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  const gate = await adminGate();
  if (gate.error) return gate.error;
  const admin = gate.admin!;

  const body = await req.json().catch(() => ({})) as { entityIds?: string[] };
  const requestedIds = [...new Set(body.entityIds ?? [])];
  if (requestedIds.length === 0) return NextResponse.json({ ok: false, error: 'entityIds is required.' }, { status: 400 });

  // Re-verified against the live data, not the client's snapshot — an
  // entity someone else already promoted (or that lost its verified
  // contribution) between preview and apply is silently skipped, not
  // written over.
  const candidates = await findCandidates(admin, requestedIds);
  const byId = new Map(candidates.map((c) => [c.entityId, c]));

  const applied: string[] = [];
  const skipped: { entityId: string; reason: string }[] = [];

  for (const entityId of requestedIds) {
    const c = byId.get(entityId);
    if (!c) { skipped.push({ entityId, reason: 'No longer eligible (already has contacts, or the verified research is gone).' }); continue; }
    if (c.needsReview) { skipped.push({ entityId, reason: 'Needs review — the text doesn\'t parse cleanly into name + role.' }); continue; }

    const rows = c.parsed.map((p, i) => ({
      org_id: c.orgId, entity_id: c.entityId, full_name: p.fullName, role: p.role,
      seniority_rank: i + 1, data_source: 'Promoted from verified key_people research (bulk)',
    }));
    const { error } = await admin.from('people').insert(rows);
    if (error) { skipped.push({ entityId, reason: error.message }); continue; }
    applied.push(entityId);
  }

  return NextResponse.json({ ok: true, applied, skipped });
}
