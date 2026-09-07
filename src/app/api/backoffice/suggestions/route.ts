// Prompt 605 §E — the suggestions queue. A different QUERY over
// support_tickets, not a different table (§A): same rows, same events
// history, same attachment scans; only the question being asked is
// different, and so is what an operator needs on screen.
//
// What §E asks for, and where each piece comes from:
//  - "De onde veio (`area`) e de quem, com o badge à vista" — `area` is on
//    the ticket (filled from the route, never asked); the badge is read live
//    from platform_badges for the ticket's org, because "a sugestão de um
//    tech master é literalmente o que o programa foi comprar".
//  - "A captura, visível na própria linha, não atrás de um download" — every
//    attachment path is signed here, so the list renders images inline. Same
//    signing rules as the ticket detail route, malware gate included.
//  - "Um estado próprio do ciclo de uma ideia" — suggestion_status, and the
//    outcome fields that give the queue an exit.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { supportAttachmentScanAvailable } from '@/lib/upload-security-capability';
import { supportSuggestionsAvailable } from '@/lib/support-suggestions-capability';
import { platformBadgesAvailable } from '@/lib/platform-badges-capability';
import { qualifyingBadge } from '@/lib/suggestions-gate';

export interface SuggestionRow {
  id: string;
  created_at: string;
  last_activity_at: string;
  name: string;
  email: string;
  org_id: string | null;
  org_name: string | null;
  badge: string | null;
  area: string | null;
  subject: string;
  message: string;
  suggestion_status: string;
  suggestion_outcome: string | null;
  suggestion_outcome_url: string | null;
  attachments: { path: string; url: string | null; malwareFlagged?: boolean }[];
}

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  // Before 0339 the column does not exist and `select('*')` would still
  // succeed — returning every suggestion-shaped field as undefined. Probing
  // first means an unmigrated environment says "not available" instead of
  // rendering an empty queue that looks like "nobody has suggested anything".
  if (!(await supportSuggestionsAvailable())) {
    return NextResponse.json({ ok: false, error: 'Suggestions need migration 0339.' }, { status: 200 });
  }

  const { data: rows, error } = await admin.from('support_tickets')
    .select('*').eq('category', 'suggestion').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const tickets = rows ?? [];
  const orgIds = [...new Set(tickets.map((t) => t.org_id as string | null).filter((x): x is string => !!x))];

  const orgNames = new Map<string, string>();
  const orgBadges = new Map<string, string[]>();
  if (orgIds.length) {
    const { data: orgs } = await admin.from('orgs').select('id, name').in('id', orgIds);
    for (const o of orgs ?? []) orgNames.set(o.id as string, o.name as string);
    if (await platformBadgesAvailable()) {
      const { data: badges } = await admin.from('platform_badges')
        .select('org_id, badge').in('org_id', orgIds).is('revoked_at', null);
      for (const b of badges ?? []) {
        const list = orgBadges.get(b.org_id as string) ?? [];
        list.push(b.badge as string);
        orgBadges.set(b.org_id as string, list);
      }
    }
  }

  // Same rule as the ticket detail route: attachment_urls holds storage
  // PATHS in a private bucket, and a path the scan sweep later flagged never
  // gets a signed URL — not even for a platform admin.
  const allPaths = tickets.flatMap((t) => (t.attachment_urls as string[] | null) ?? []);
  const flagged = new Set<string>();
  if (allPaths.length && await supportAttachmentScanAvailable()) {
    const { data: scans } = await admin.from('support_attachment_scans')
      .select('storage_path').in('storage_path', allPaths).eq('malware_scan_status', 'flagged');
    for (const s of scans ?? []) flagged.add(s.storage_path as string);
  }
  const signed = new Map<string, string | null>();
  await Promise.all(allPaths.filter((p) => !flagged.has(p)).map(async (path) => {
    const { data } = await admin.storage.from('data-room').createSignedUrl(path, 300);
    signed.set(path, data?.signedUrl ?? null);
  }));

  const list: SuggestionRow[] = tickets.map((t) => ({
    id: t.id as string,
    created_at: t.created_at as string,
    last_activity_at: t.last_activity_at as string,
    name: t.name as string,
    email: t.email as string,
    org_id: (t.org_id as string | null) ?? null,
    org_name: t.org_id ? orgNames.get(t.org_id as string) ?? null : null,
    badge: t.org_id ? qualifyingBadge(orgBadges.get(t.org_id as string) ?? []) : null,
    area: (t.area as string | null) ?? null,
    subject: t.subject as string,
    message: t.message as string,
    // A row written before 0339 (there are none, but the column is nullable)
    // reads as 'received' rather than as a blank cell.
    suggestion_status: (t.suggestion_status as string | null) ?? 'received',
    suggestion_outcome: (t.suggestion_outcome as string | null) ?? null,
    suggestion_outcome_url: (t.suggestion_outcome_url as string | null) ?? null,
    attachments: ((t.attachment_urls as string[] | null) ?? []).map((path) => (
      flagged.has(path) ? { path, url: null, malwareFlagged: true } : { path, url: signed.get(path) ?? null }
    )),
  }));

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const filtered = status ? list.filter((s) => s.suggestion_status === status) : list;

  const counts = {
    received: list.filter((s) => s.suggestion_status === 'received').length,
    under_review: list.filter((s) => s.suggestion_status === 'under_review').length,
    accepted: list.filter((s) => s.suggestion_status === 'accepted').length,
    declined: list.filter((s) => s.suggestion_status === 'declined').length,
    // The nav badge counts only what still needs a decision — an accepted
    // suggestion is finished work, not an outstanding one.
    navBadge: list.filter((s) => s.suggestion_status === 'received').length,
  };

  return NextResponse.json({ ok: true, suggestions: filtered, counts });
}
