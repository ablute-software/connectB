// IRM_SPEC §6b-2 — enrichment queue. Platform admin only. Scores every
// org's entities/people with the same completeness function shown to
// founders, keeps the ones below threshold, and groups by normalized name
// across orgs so demand (how many orgs are actually chasing this profile)
// ranks the queue — an incomplete profile 5 startups are chasing outranks
// one nobody contacts. No AI research here (§6b-3) — by instruction, later.
//
// Two separate queues (see DECISIONS.md, follow-up to cc11161): the
// original queue (people + entities below ENRICHMENT_THRESHOLD on the
// firmographic score) is unchanged, same ~203-entity calibration as
// before the contact fields existed. A second, entity-only queue applies
// the actionable contact rule (qualifiesForContactEnrichment) instead of
// a raw percent cutoff — see completeness.ts for why a percent threshold
// doesn't work for the contact dimension yet.
//
// Prompt 594 §B — orgCount/activeCount/demand now count DISTINCT orgs, not
// rows. Two `people` rows sharing one org_id (the exact shape of the
// Ricardo Jacinto duplicate 594 §C found — same org, two person rows,
// created 2 seconds apart in the same import) used to inflate demand by
// double-counting one org as two, which the queue's own sort then acted
// on directly (higher demand = higher in the queue). A name matching two
// rows in the SAME org was never "2 orgs chasing this profile."
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { entityCompleteness, personCompleteness, qualifiesForContactEnrichment, ENRICHMENT_THRESHOLD, ENRICHMENT_REQUEST_FIELD, type PersonCatalogSide } from '@/lib/completeness';
import type { Entity, Person } from '@/lib/types';

type Row = {
  subjectType: 'entity' | 'person'; name: string; orgId: string; active: boolean;
  percent: number; missing: string[]; requestCount: number;
  // Prompt 594 §D — the catalog row this private-pipeline row is linked to,
  // when it is. The queue groups by NAME (an aggregate across orgs, with no
  // single id of its own), so a "open this profile" link needs the catalog
  // id carried up from whichever grouped row actually has one. Null for the
  // unlinked majority — 1299 of 1782 people rows today (595 §C) — and the
  // client then renders plain text rather than a link to nowhere.
  catalogId: string | null;
};
type QueueItem = {
  subjectType: 'entity' | 'person'; name: string; orgCount: number; activeCount: number;
  requestCount: number; minPercent: number; missing: string[]; demand: number; catalogId: string | null;
};

function buildQueue(rows: Row[]): QueueItem[] {
  const groups = new Map<string, {
    subjectType: 'entity' | 'person'; name: string; orgIds: Set<string>; activeOrgIds: Set<string>;
    requestCount: number; minPercent: number; missing: Set<string>; catalogId: string | null;
  }>();
  for (const r of rows) {
    const key = `${r.subjectType}:${r.name.trim().toLowerCase()}`;
    const g = groups.get(key) ?? {
      subjectType: r.subjectType, name: r.name, orgIds: new Set<string>(), activeOrgIds: new Set<string>(),
      requestCount: 0, minPercent: 100, missing: new Set<string>(), catalogId: null,
    };
    g.orgIds.add(r.orgId);
    if (r.active) g.activeOrgIds.add(r.orgId);
    g.requestCount += r.requestCount;
    g.minPercent = Math.min(g.minPercent, r.percent);
    r.missing.forEach((m) => g.missing.add(m));
    g.catalogId = g.catalogId ?? r.catalogId;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({
      subjectType: g.subjectType, name: g.name, orgCount: g.orgIds.size, activeCount: g.activeOrgIds.size,
      requestCount: g.requestCount, minPercent: g.minPercent, missing: [...g.missing],
      demand: g.activeOrgIds.size + g.requestCount, catalogId: g.catalogId,
    }))
    .sort((a, b) => b.demand - a.demand || a.minPercent - b.minPercent)
    .slice(0, 50);
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const role = await resolveRole(user.id, user.email, sb, user.email_confirmed_at);
  if (role !== 'developer') return NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const [{ data: entities, error: eErr }, { data: people, error: pErr }, { data: requests, error: rErr }] = await Promise.all([
    admin.from('entities').select('*'),
    admin.from('people').select('*'),
    admin.from('contributions').select('subject_type, subject_id').eq('field', ENRICHMENT_REQUEST_FIELD),
  ]);
  if (eErr || pErr) return NextResponse.json({ ok: false, error: (eErr ?? pErr)?.message }, { status: 500 });
  // contributions may not exist yet (pending migration) — treat as "no requests" rather than failing the whole queue.
  const requestCountBySubject = new Map<string, number>();
  if (!rErr) {
    for (const r of requests ?? []) {
      const key = `${r.subject_type}:${r.subject_id}`;
      requestCountBySubject.set(key, (requestCountBySubject.get(key) ?? 0) + 1);
    }
  }

  // Prompt 595 §C — "missing" must not accuse a person of lacking a field
  // the catalog already has for the SAME real person (confirmed live: João
  // Coelho Borges' catalog_person_id row carries a verified LinkedIn the
  // queue was calling missing). One extra round trip per field source,
  // scoped to only the catalog_person_ids actually referenced below —
  // never all of catalog_people/catalog_people_research.
  const catalogPersonIds = [...new Set((people ?? []).map((p) => (p as Person).catalog_person_id).filter((id): id is string => !!id))];
  const [{ data: catalogPeople }, { data: catalogResearch }] = catalogPersonIds.length
    ? await Promise.all([
        admin.from('catalog_people').select('id, linkedin_url').in('id', catalogPersonIds),
        admin.from('catalog_people_research').select('person_id, hook, background, email_verified, email_guess').in('person_id', catalogPersonIds),
      ])
    : [{ data: [] as { id: string; linkedin_url: string | null }[] }, { data: [] as { person_id: string; hook: string | null; background: string | null; email_verified: string | null; email_guess: string | null }[] }];
  const catalogSideById = new Map<string, PersonCatalogSide>();
  for (const cp of catalogPeople ?? []) catalogSideById.set(cp.id, { linkedin_url: cp.linkedin_url });
  for (const cr of catalogResearch ?? []) {
    const existing = catalogSideById.get(cr.person_id) ?? {};
    catalogSideById.set(cr.person_id, { ...existing, hook: cr.hook, background: cr.background, email_verified: cr.email_verified, email_guess: cr.email_guess });
  }

  const profileRows: Row[] = [];
  const contactRows: Row[] = [];
  for (const e of (entities ?? []) as Entity[]) {
    const c = entityCompleteness(e);
    const active = !['dormant', 'passed'].includes(e.status);
    const requestCount = requestCountBySubject.get(`entity:${e.id}`) ?? 0;
    // org_id is NOT NULL on entities (confirmed against the schema) — the
    // Entity type only marks it optional because most callers don't select it.
    const orgId = e.org_id!;
    const catalogId = (e as Entity & { catalog_id?: string | null }).catalog_id ?? null;
    if (c.firmographic.percent < ENRICHMENT_THRESHOLD) {
      profileRows.push({ subjectType: 'entity', name: e.name, orgId, active, percent: c.firmographic.percent, missing: c.firmographic.missing, requestCount, catalogId });
    }
    if (qualifiesForContactEnrichment(c)) {
      contactRows.push({ subjectType: 'entity', name: e.name, orgId, active, percent: c.contact.percent, missing: c.contact.missing, requestCount, catalogId });
    }
  }
  for (const p of (people ?? []) as Person[]) {
    const catalogSide = p.catalog_person_id ? catalogSideById.get(p.catalog_person_id) : undefined;
    const c = personCompleteness(p, catalogSide);
    if (c.percent >= ENRICHMENT_THRESHOLD || p.do_not_contact) continue;
    profileRows.push({
      // org_id is NOT NULL on people (confirmed against the schema) — the
      // Person type only marks it optional because most callers don't
      // select it, not because the column can be empty.
      subjectType: 'person', name: p.full_name, orgId: p.org_id!, active: true,
      percent: c.percent, missing: c.missing, requestCount: requestCountBySubject.get(`person:${p.id}`) ?? 0,
      catalogId: p.catalog_person_id ?? null,
    });
  }

  return NextResponse.json({ ok: true, profileQueue: buildQueue(profileRows), contactQueue: buildQueue(contactRows) });
}
