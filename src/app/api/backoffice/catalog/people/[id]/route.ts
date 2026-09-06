// Prompt 581 §C — the back-office person dossier's own data. One GET
// assembles everything the page needs (identity, affiliations, research,
// quarantine, activity, manual-research links) in a single round trip,
// matching every other back-office dossier-shaped route in this codebase.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

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
      .select('id, org_id, field, value, status, created_at, reviewer_notes, orgs(name)')
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
  const contributionsByField = new Map<string, { org: string; value: unknown; status: string; createdAt: string }[]>();
  for (const c of contributionsRaw ?? []) {
    const org = (c.orgs as unknown as { name: string } | null)?.name ?? '(unknown org)';
    const list = contributionsByField.get(c.field) ?? [];
    list.push({ org, value: c.value, status: c.status, createdAt: c.created_at });
    contributionsByField.set(c.field, list);
  }
  const quarantine = [...contributionsByField.entries()].map(([field, entries]) => ({
    field,
    verifiedCount: entries.filter((e) => e.status === 'verified').length,
    entries,
  }));

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
