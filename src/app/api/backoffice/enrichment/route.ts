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
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { entityCompleteness, personCompleteness, qualifiesForContactEnrichment, ENRICHMENT_THRESHOLD, ENRICHMENT_REQUEST_FIELD } from '@/lib/completeness';
import type { Entity, Person } from '@/lib/types';

type Row = { subjectType: 'entity' | 'person'; name: string; active: boolean; percent: number; missing: string[]; requestCount: number };
type QueueItem = { subjectType: 'entity' | 'person'; name: string; orgCount: number; activeCount: number; requestCount: number; minPercent: number; missing: string[]; demand: number };

function buildQueue(rows: Row[]): QueueItem[] {
  const groups = new Map<string, { subjectType: 'entity' | 'person'; name: string; orgCount: number; activeCount: number; requestCount: number; minPercent: number; missing: Set<string> }>();
  for (const r of rows) {
    const key = `${r.subjectType}:${r.name.trim().toLowerCase()}`;
    const g = groups.get(key) ?? { subjectType: r.subjectType, name: r.name, orgCount: 0, activeCount: 0, requestCount: 0, minPercent: 100, missing: new Set<string>() };
    g.orgCount += 1;
    if (r.active) g.activeCount += 1;
    g.requestCount += r.requestCount;
    g.minPercent = Math.min(g.minPercent, r.percent);
    r.missing.forEach((m) => g.missing.add(m));
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, missing: [...g.missing], demand: g.activeCount + g.requestCount }))
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

  const profileRows: Row[] = [];
  const contactRows: Row[] = [];
  for (const e of (entities ?? []) as Entity[]) {
    const c = entityCompleteness(e);
    const active = !['dormant', 'passed'].includes(e.status);
    const requestCount = requestCountBySubject.get(`entity:${e.id}`) ?? 0;
    if (c.firmographic.percent < ENRICHMENT_THRESHOLD) {
      profileRows.push({ subjectType: 'entity', name: e.name, active, percent: c.firmographic.percent, missing: c.firmographic.missing, requestCount });
    }
    if (qualifiesForContactEnrichment(c)) {
      contactRows.push({ subjectType: 'entity', name: e.name, active, percent: c.contact.percent, missing: c.contact.missing, requestCount });
    }
  }
  for (const p of (people ?? []) as Person[]) {
    const c = personCompleteness(p);
    if (c.percent >= ENRICHMENT_THRESHOLD || p.do_not_contact) continue;
    profileRows.push({
      subjectType: 'person', name: p.full_name, active: true,
      percent: c.percent, missing: c.missing, requestCount: requestCountBySubject.get(`person:${p.id}`) ?? 0,
    });
  }

  return NextResponse.json({ ok: true, profileQueue: buildQueue(profileRows), contactQueue: buildQueue(contactRows) });
}
