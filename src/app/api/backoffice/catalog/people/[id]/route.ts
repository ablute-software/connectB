// Prompt 581 §C — the back-office person dossier's own data. One GET
// assembles everything the page needs (identity, affiliations, research,
// quarantine, activity, manual-research links) in a single round trip,
// matching every other back-office dossier-shaped route in this codebase.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

const TEAM_PAGE_PATHS = ['/team', '/about', '/people'];
const TEAM_PAGE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function withProtocol(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// §C.5 — "só as que respondem 200, verificado no servidor com cache".
// Parallel, short-timeout HEAD checks; first 200 wins. Never throws — a
// dead/slow site must not break the dossier, just leave the link out.
async function checkTeamPage(website: string): Promise<string | null> {
  const base = withProtocol(website).replace(/\/+$/, '');
  const attempts = TEAM_PAGE_PATHS.map(async (path) => {
    const url = base + path;
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(4000) });
      return res.ok ? url : null;
    } catch {
      return null;
    }
  });
  const results = await Promise.all(attempts);
  return results.find((r) => r !== null) ?? null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  const { id } = params;

  const { data: person } = await admin.from('catalog_people').select('*').eq('id', id).maybeSingle();
  if (!person) return NextResponse.json({ ok: false, error: 'Person not found.' }, { status: 404 });

  const [{ data: research }, { data: affiliationsRaw }, { data: contributionsRaw }] = await Promise.all([
    admin.from('catalog_people_research').select('*').eq('person_id', id).maybeSingle(),
    admin.from('catalog_person_affiliations')
      .select('id, entity_id, title, kind, is_primary, current, started_at, ended_at, catalog_entities(id, name, website, verification_status)')
      .eq('person_id', id)
      .order('is_primary', { ascending: false })
      .order('current', { ascending: false }),
    admin.from('contributions')
      .select('id, org_id, field, value, status, created_at, reviewer_notes, orgs(name, is_test, is_internal)')
      .eq('subject_type', 'catalog_person').eq('subject_id', id)
      .order('created_at', { ascending: false }),
  ]);

  const affiliations = (affiliationsRaw ?? []).map((a) => {
    const entity = a.catalog_entities as unknown as { id: string; name: string; website: string | null; verification_status: string } | null;
    return {
      entityId: a.entity_id, entityName: entity?.name ?? '(deleted)', entityVerified: entity?.verification_status === 'verified',
      title: a.title, kind: a.kind, isPrimary: a.is_primary, current: a.current, startedAt: a.started_at, endedAt: a.ended_at,
    };
  });

  // §C.4 — quarantine vs. already-accepted, grouped by field so 3
  // separate org rows read as "3 startups say X", not 3 unrelated lines.
  // Prompt 871 §D — `id` added so the admin approve/reject action (below)
  // can target the exact contributions it affects, and isTest/isInternal
  // so the dossier can show the same real-org-only count migration 0328's
  // consensus trigger now enforces, rather than a raw row count that
  // could include orgs that can never actually reach consensus.
  const contributionsByField = new Map<string, { id: string; org: string; isTest: boolean; value: unknown; status: string; createdAt: string }[]>();
  for (const c of contributionsRaw ?? []) {
    const org = c.orgs as unknown as { name: string; is_test: boolean; is_internal: boolean } | null;
    const list = contributionsByField.get(c.field) ?? [];
    list.push({
      id: c.id, org: org?.name ?? '(unknown org)', isTest: !!(org?.is_test || org?.is_internal),
      value: c.value, status: c.status, createdAt: c.created_at,
    });
    contributionsByField.set(c.field, list);
  }
  const normalizeForGrouping = (value: unknown): string => Array.isArray(value)
    ? [...value].map((v) => String(v).toLowerCase().trim()).sort().join('|')
    : String(value).toLowerCase().trim();
  const quarantine = [...contributionsByField.entries()].map(([field, entries]) => {
    // One admin action targets one specific (field, value) claim — group
    // entries by their normalized value (same rule migration 0328's
    // catalog_person_normalize_value uses) so the dossier can offer
    // Approve/Reject per distinct claim, not per individual org row.
    const byValue = new Map<string, typeof entries>();
    for (const e of entries) {
      const key = normalizeForGrouping(e.value);
      byValue.set(key, [...(byValue.get(key) ?? []), e]);
    }
    const values = [...byValue.values()].map((group) => ({
      value: group[0].value,
      realOrgCount: new Set(group.filter((e) => !e.isTest && (e.status === 'submitted' || e.status === 'verified')).map((e) => e.org)).size,
      entries: group,
    }));
    return {
      field,
      verifiedCount: entries.filter((e) => e.status === 'verified').length,
      entries,
      values,
    };
  });

  // §C.5 — manual research, server-checked team page (cached on the
  // primary entity so N people at the same firm share one check).
  const primary = affiliations.find((a) => a.isPrimary) ?? affiliations[0];
  const primaryEntityRaw = (affiliationsRaw ?? []).find((a) => a.entity_id === primary?.entityId);
  const primaryEntity = primaryEntityRaw?.catalog_entities as unknown as { id: string; website: string | null } | null;

  let teamPageUrl: string | null = null;
  if (primaryEntity?.website) {
    const { data: cached } = await admin.from('catalog_entities')
      .select('team_page_url, team_page_checked_at').eq('id', primaryEntity.id).maybeSingle();
    const stale = !cached?.team_page_checked_at
      || Date.now() - new Date(cached.team_page_checked_at).getTime() > TEAM_PAGE_CACHE_TTL_MS;
    if (stale) {
      teamPageUrl = await checkTeamPage(primaryEntity.website);
      await admin.from('catalog_entities').update({ team_page_url: teamPageUrl, team_page_checked_at: new Date().toISOString() }).eq('id', primaryEntity.id);
    } else {
      teamPageUrl = cached.team_page_url;
    }
  }

  const nameQuery = encodeURIComponent(`"${person.full_name}"${primary ? ` "${affiliations[0].entityName}"` : ''}`);
  const manualLinks = {
    linkedin: person.linkedin_url || `https://www.google.com/search?q=${nameQuery}+site:linkedin.com`,
    google: `https://www.google.com/search?q=${nameQuery}`,
    teamPage: teamPageUrl,
    crunchbase: `https://www.crunchbase.com/textsearch?q=${encodeURIComponent(person.full_name)}`,
    dealroom: `https://app.dealroom.co/search?q=${encodeURIComponent(person.full_name)}`,
  };

  // §C.6 — counts across every org's own private `people` row for this
  // catalog person, never content (per the prompt's own privacy line and
  // this project's broader founder-performance-privacy rule).
  const { data: linkedPeople } = await admin.from('people').select('id, org_id').eq('catalog_person_id', id);
  const peopleIds = (linkedPeople ?? []).map((p) => p.id);
  let activity = { totalInteractions: 0, orgsInteracted: 0, lastContactedAt: null as string | null, repliesReceived: 0 };
  if (peopleIds.length > 0) {
    const { data: interactions } = await admin.from('interactions')
      .select('org_id, occurred_at, direction').in('person_id', peopleIds);
    const rows = interactions ?? [];
    activity = {
      totalInteractions: rows.length,
      orgsInteracted: new Set(rows.map((r) => r.org_id)).size,
      lastContactedAt: rows.reduce<string | null>((max, r) => (!max || r.occurred_at > max ? r.occurred_at : max), null),
      repliesReceived: rows.filter((r) => r.direction === 'inbound').length,
    };
  }

  return NextResponse.json({
    ok: true,
    person: {
      id: person.id, fullName: person.full_name,
      // Prompt 599 §3 — the current-firm pointer, exposed so the dossier can
      // say when it disagrees with the primary affiliation (31 rows did on
      // 2026-09-07). The affiliations list, not this pointer, is the truth.
      entityId: person.entity_id ?? null,
      linkedinUrl: person.linkedin_url, linkedinVerified: person.linkedin_verified,
      basedIn: person.based_in,
      doNotContact: person.do_not_contact, privacyNoticeSent: person.privacy_notice_sent,
      hookStatus: person.hook_status,
    },
    research: research ? {
      bioRaw: research.bio_raw, hook: research.hook, introPath: research.intro_path,
      watchOuts: research.watch_outs, killWords: research.kill_words, background: research.background,
      emailGuess: research.email_guess, emailGuessConfidence: research.email_guess_confidence,
      verifiedFields: research.verified_fields ?? {}, updatedAt: research.updated_at,
    } : null,
    affiliations,
    quarantine,
    manualLinks,
    activity,
  });
}

// Prompt 595 §D / 597 — a developer edits a catalog person's field and it is
// live immediately: no quarantine, no consensus wait, mirroring what 584
// gave catalog ENTITIES. Nuno's requirement is textual — such data is
// "assumido como verificado e credível" — so the write goes through
// catalog_person_apply_field(..., 'verified_by_admin'), the same path the
// consensus engine already reads, rather than a raw UPDATE that would leave
// the value unmarked and therefore overwritable by three agreeing startups
// later. That was 597's whole argument for option 1, and the option chosen.
//
// 597's CONDITION — that a consensus blocked by an admin-verified field stop
// being silent — lives inside catalog_person_check_consensus() itself, which
// 597 routes to the "parallel" session (same infrastructure as 871 §D). Not
// done here: flagged, not silently assumed handled.
const EDITABLE_FIELDS = new Set(['role', 'based_in', 'linkedin_url', 'background', 'hook', 'watch_outs', 'intro_path', 'email_guess', 'kill_words']);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  const { id } = params;

  const { field, value } = await req.json().catch(() => ({})) as { field?: string; value?: unknown };
  if (!field || !EDITABLE_FIELDS.has(field)) {
    return NextResponse.json({ ok: false, error: `Field must be one of: ${[...EDITABLE_FIELDS].join(', ')}` }, { status: 400 });
  }

  // Before/after in the audit line, not just the field name — the bar 584 §C
  // set for entities ("valores antes/depois, não só nomes de campo").
  const [{ data: person }, { data: researchBefore }, { data: primaryAff }] = await Promise.all([
    admin.from('catalog_people').select('id, linkedin_url, based_in').eq('id', id).maybeSingle(),
    admin.from('catalog_people_research').select('hook, background, watch_outs, intro_path, email_guess, kill_words').eq('person_id', id).maybeSingle(),
    admin.from('catalog_person_affiliations').select('title').eq('person_id', id).eq('is_primary', true).maybeSingle(),
  ]);
  if (!person) return NextResponse.json({ ok: false, error: 'No catalog person with that id.' }, { status: 404 });

  const previous = field === 'role'
    ? primaryAff?.title ?? null
    : ((person as Record<string, unknown>)[field] ?? (researchBefore as Record<string, unknown> | null)?.[field] ?? null);

  const { error: rpcErr } = await admin.rpc('catalog_person_apply_field', {
    p_person_id: id, p_field: field, p_value: value ?? null, p_level: 'verified_by_admin',
  });
  if (rpcErr) return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });

  // catalog_person_apply_field deliberately writes nothing (and marks
  // nothing) when 'role' has no primary affiliation to land on — Prompt
  // 871's own "Menores" fix. Read verified_fields back rather than reporting
  // a success the database never recorded.
  const { data: after } = await admin.from('catalog_people_research').select('verified_fields').eq('person_id', id).maybeSingle();
  const applied = !!(after?.verified_fields as Record<string, string> | null)?.[field];

  await logAdminAction(admin, {
    adminUserId: userId, action: 'catalog_person_field_edit', subjectType: 'catalog_person', subjectId: id,
    detail: { field, from: previous, to: value ?? null, level: 'verified_by_admin', applied },
  });

  return NextResponse.json({
    ok: true, applied,
    message: applied ? undefined : 'Nothing was written — this person has no primary affiliation for a role to attach to.',
  });
}
