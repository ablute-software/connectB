// Prompt 599 §2 — a startup's PRIVATE `people` row, opened from anywhere in
// the back-office (the Quality queue's person rows, a New investors
// candidate's contacts). Before this, a `people` row with no
// catalog_person_id — 1299 of 1782, João Bandeira among them — had no page
// and no editor: the only person editor was the catalog dossier, and these
// rows are not in the catalog.
//
// Three cases, decided by catalog_person_id:
//   - unlinked → the developer edits the private row directly (PATCH,
//     audited with before/after) and is offered the link §5's gate would
//     make (POST), classified by the same pure rule the batch used;
//   - linked   → the catalog is the source of truth: PATCH answers 409 and
//     the page sends the developer to the catalog dossier instead;
//   - a catalog_people row never reaches here — it has its own dossier.
//
// Founder-private content stays out of every response: personal_notes is
// the founder's own text and is never selected. Everything else on the row
// is the startup's description of an investor contact, which the
// back-office already reads for the Quality queue.
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import {
  candidateFirmMatches, classifyLinkCandidates, normalizePersonName, type LinkCandidate, type LinkLayer,
} from '@/lib/person-link';

const PERSON_COLUMNS = 'id, org_id, entity_id, full_name, role, seniority_rank, based_in, linkedin_url, linkedin_verified, '
  + 'email_guess, email_guess_confidence, email_verified, phone, background, hook, hook_status, watch_outs, intro_path, '
  + 'kill_words, do_not_contact, privacy_notice_sent, data_source, catalog_person_id, created_at, updated_at';

// Mirrors the catalog editor's set (minus kill_words, an array the private
// editor has no widget for) plus phone, which the private row has and the
// catalog does not. full_name is deliberately absent: the name is the
// identity the link proposal below is computed from — renaming a row is a
// different operation from correcting a field on it.
const EDITABLE_FIELDS = new Set(['role', 'based_in', 'linkedin_url', 'email_guess', 'phone', 'background', 'hook', 'watch_outs', 'intro_path']);

type PersonRow = {
  id: string; org_id: string; entity_id: string; full_name: string; role: string | null; seniority_rank: number;
  based_in: string | null; linkedin_url: string | null; linkedin_verified: boolean;
  email_guess: string | null; email_guess_confidence: string | null; email_verified: string | null; phone: string | null;
  background: string | null; hook: string | null; hook_status: string; watch_outs: string | null; intro_path: string | null;
  kill_words: string[] | null; do_not_contact: boolean; privacy_notice_sent: boolean; data_source: string | null;
  catalog_person_id: string | null; created_at: string; updated_at: string;
};

// PostgREST caps a select at 1000 rows silently — the exact bug 596 §A found
// in the key-people queue. 3230 catalog people today, so page explicitly.
async function allCatalogPeople(admin: SupabaseClient): Promise<{ id: string; full_name: string; entity_id: string | null }[]> {
  const out: { id: string; full_name: string; entity_id: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('catalog_people').select('id, full_name, entity_id').order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type Proposal = {
  layer: LinkLayer;
  firmCatalogId: string | null;
  candidates: { id: string; fullName: string; firmName: string | null; firmMatch: boolean }[];
};

// The same-name candidates for ONE private row, classified by §5's rule.
// Shared by GET (to show the proposal) and POST (to refuse a link to a
// catalog person who is not actually a same-name candidate) so both agree.
async function loadProposal(admin: SupabaseClient, person: PersonRow, firmCatalogId: string | null): Promise<{ proposal: Proposal; raw: LinkCandidate[] }> {
  const target = normalizePersonName(person.full_name);
  const all = target ? await allCatalogPeople(admin) : [];
  const sameName = all.filter((c) => normalizePersonName(c.full_name) === target);
  const ids = sameName.map((c) => c.id);
  const { data: affs } = ids.length
    ? await admin.from('catalog_person_affiliations').select('person_id, entity_id').in('person_id', ids)
    : { data: [] as { person_id: string; entity_id: string }[] };
  const firmIds = [...new Set([...sameName.map((c) => c.entity_id), ...(affs ?? []).map((a) => a.entity_id)].filter((v): v is string => !!v))];
  const { data: firms } = firmIds.length
    ? await admin.from('catalog_entities').select('id, name').in('id', firmIds)
    : { data: [] as { id: string; name: string }[] };
  const firmName = new Map((firms ?? []).map((f) => [f.id, f.name]));

  const raw: LinkCandidate[] = sameName.map((c) => ({
    id: c.id, fullName: c.full_name, entityId: c.entity_id,
    affiliationEntityIds: (affs ?? []).filter((a) => a.person_id === c.id).map((a) => a.entity_id),
  }));
  const cls = classifyLinkCandidates(raw, firmCatalogId);
  return {
    raw,
    proposal: {
      layer: cls.layer, firmCatalogId,
      candidates: raw.map((c) => ({
        id: c.id, fullName: c.fullName,
        firmName: c.entityId ? firmName.get(c.entityId) ?? null : null,
        firmMatch: candidateFirmMatches(c, firmCatalogId),
      })),
    },
  };
}

async function loadPerson(admin: SupabaseClient, id: string): Promise<PersonRow | null> {
  const { data } = await admin.from('people').select(PERSON_COLUMNS).eq('id', id).maybeSingle();
  return (data as PersonRow | null) ?? null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const person = await loadPerson(admin, params.id);
  if (!person) return NextResponse.json({ ok: false, error: 'No private person row with that id.' }, { status: 404 });

  const [{ data: org }, { data: entity }] = await Promise.all([
    admin.from('orgs').select('id, name, is_test, is_internal').eq('id', person.org_id).maybeSingle(),
    admin.from('entities').select('id, name, catalog_id').eq('id', person.entity_id).maybeSingle(),
  ]);
  const firmCatalogId = (entity?.catalog_id as string | null) ?? null;
  const { data: catalogFirm } = firmCatalogId
    ? await admin.from('catalog_entities').select('id, name').eq('id', firmCatalogId).maybeSingle()
    : { data: null };

  let linked: { id: string; fullName: string; linkedinUrl: string | null; firmName: string | null } | null = null;
  let proposal: Proposal | null = null;
  if (person.catalog_person_id) {
    const { data: cp } = await admin.from('catalog_people').select('id, full_name, linkedin_url, entity_id').eq('id', person.catalog_person_id).maybeSingle();
    const { data: cpFirm } = cp?.entity_id
      ? await admin.from('catalog_entities').select('name').eq('id', cp.entity_id).maybeSingle()
      : { data: null };
    linked = cp
      ? { id: cp.id, fullName: cp.full_name, linkedinUrl: cp.linkedin_url, firmName: cpFirm?.name ?? null }
      : { id: person.catalog_person_id, fullName: '(catalog person no longer exists)', linkedinUrl: null, firmName: null };
  } else {
    try {
      proposal = (await loadProposal(admin, person, firmCatalogId)).proposal;
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    person: {
      id: person.id, fullName: person.full_name, role: person.role, seniorityRank: person.seniority_rank,
      basedIn: person.based_in, linkedinUrl: person.linkedin_url, linkedinVerified: person.linkedin_verified,
      emailGuess: person.email_guess, emailGuessConfidence: person.email_guess_confidence, emailVerified: person.email_verified,
      phone: person.phone, background: person.background, hook: person.hook, hookStatus: person.hook_status,
      watchOuts: person.watch_outs, introPath: person.intro_path, killWords: person.kill_words ?? [],
      doNotContact: person.do_not_contact, privacyNoticeSent: person.privacy_notice_sent, dataSource: person.data_source,
      catalogPersonId: person.catalog_person_id, createdAt: person.created_at, updatedAt: person.updated_at,
    },
    org: org ? { id: org.id, name: org.name, isTest: !!(org.is_test || org.is_internal) } : null,
    entity: entity ? { id: entity.id, name: entity.name, catalogId: firmCatalogId, catalogName: catalogFirm?.name ?? null } : null,
    linked,
    proposal,
  });
}

// A field on the startup's own row. Refused for a linked row: once a
// catalog_person_id exists the catalog is the source (Prompt 871 §E's
// overlay reads it at render time), and a private write would be exactly
// the "indistinguishable from the org's own declaration" problem that
// decision removed.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { field, value } = await req.json().catch(() => ({})) as { field?: string; value?: unknown };
  if (!field || !EDITABLE_FIELDS.has(field)) {
    return NextResponse.json({ ok: false, error: `Field must be one of: ${[...EDITABLE_FIELDS].join(', ')}` }, { status: 400 });
  }
  if (value != null && typeof value !== 'string') {
    return NextResponse.json({ ok: false, error: 'Value must be a string.' }, { status: 400 });
  }

  const person = await loadPerson(admin, params.id);
  if (!person) return NextResponse.json({ ok: false, error: 'No private person row with that id.' }, { status: 404 });
  if (person.catalog_person_id) {
    return NextResponse.json({
      ok: false,
      error: 'This row is linked to a catalog person — the catalog is the source. Edit it there.',
      catalogPersonId: person.catalog_person_id,
    }, { status: 409 });
  }

  const next = typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  const previous = (person as unknown as Record<string, unknown>)[field] ?? null;
  const { error } = await admin.from('people').update({ [field]: next, updated_at: new Date().toISOString() }).eq('id', person.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: userId, action: 'private_person_field_edit', subjectType: 'person', subjectId: person.id,
    detail: { field, from: previous, to: next, orgId: person.org_id, entityId: person.entity_id },
  });
  return NextResponse.json({ ok: true });
}

// Link this private row to ONE catalog person, by explicit developer
// decision. The server re-derives the same-name candidates and refuses a
// target that is not one of them, so the UI can never link two different
// names by mistake. Layer 1 is what §5's batch wrote on its own; layer 2 is
// exactly the "a person decides" case, and a single click on a single row
// is that person deciding — not the mass write §0.2 forbids.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { catalogPersonId } = await req.json().catch(() => ({})) as { catalogPersonId?: string };
  if (!catalogPersonId || typeof catalogPersonId !== 'string') {
    return NextResponse.json({ ok: false, error: 'catalogPersonId is required.' }, { status: 400 });
  }

  const person = await loadPerson(admin, params.id);
  if (!person) return NextResponse.json({ ok: false, error: 'No private person row with that id.' }, { status: 404 });
  if (person.catalog_person_id) {
    return NextResponse.json({ ok: false, error: 'Already linked to a catalog person.' }, { status: 409 });
  }

  const { data: entity } = await admin.from('entities').select('catalog_id').eq('id', person.entity_id).maybeSingle();
  const firmCatalogId = (entity?.catalog_id as string | null) ?? null;
  let proposal: Proposal;
  try {
    proposal = (await loadProposal(admin, person, firmCatalogId)).proposal;
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  const target = proposal.candidates.find((c) => c.id === catalogPersonId);
  if (!target) {
    return NextResponse.json({ ok: false, error: 'That catalog person does not have the same name as this row — not linking.' }, { status: 400 });
  }

  const { error } = await admin.from('people').update({ catalog_person_id: catalogPersonId, updated_at: new Date().toISOString() }).eq('id', person.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: userId, action: 'private_person_linked', subjectType: 'person', subjectId: person.id,
    detail: {
      catalogPersonId, catalogPersonName: target.fullName, catalogFirm: target.firmName,
      layer: proposal.layer, firmMatch: target.firmMatch, orgId: person.org_id, entityId: person.entity_id,
    },
  });
  return NextResponse.json({ ok: true, layer: proposal.layer, firmMatch: target.firmMatch });
}
