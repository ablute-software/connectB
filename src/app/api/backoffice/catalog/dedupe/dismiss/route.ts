// Prompt 580 §B.1 — "Not duplicates" for a cluster the merge tool proposed.
// Two things happen, and only these two:
//   1. Persist every pairwise combination in the group as dismissed
//      (migration 0318) so the same false-positive shape doesn't reappear —
//      a genuinely different future match involving one of these ids still
//      would, since dismissal is keyed per PAIR, not per whole cluster.
//   2. Delete the entity_aliases rows that actually tied the group
//      together via the 'alias' reason — re-derived here from the real
//      data (normalizeName, the same function catalog-dedupe.ts uses),
//      never trusted from the client, since this is the one destructive
//      step. A name/domain-based edge deletes nothing: two firms merely
//      having similar real names isn't a row to remove, just a match to
//      stop suggesting.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { normalizeName } from '@/lib/catalog-dedupe';
import { logAdminAction } from '@/lib/audit';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { ids, reason } = await req.json().catch(() => ({})) as { ids?: string[]; reason?: string };
  if (!ids || ids.length < 2) return NextResponse.json({ ok: false, error: 'At least 2 catalog ids are required.' }, { status: 400 });
  if (!reason?.trim()) return NextResponse.json({ ok: false, error: 'A reason is required.' }, { status: 400 });

  const uniqIds = [...new Set(ids)];
  const pairs: [string, string][] = [];
  for (let i = 0; i < uniqIds.length; i++) {
    for (let j = i + 1; j < uniqIds.length; j++) {
      const [a, b] = [uniqIds[i], uniqIds[j]].sort();
      pairs.push([a, b]);
    }
  }

  const { error: dismissErr } = await admin.from('catalog_dedupe_dismissals')
    .upsert(pairs.map(([a, b]) => ({
      a_catalog_id: a, b_catalog_id: b, reason: reason.trim(), dismissed_by: userId,
    })), { onConflict: 'a_catalog_id,b_catalog_id' });
  if (dismissErr) return NextResponse.json({ ok: false, error: dismissErr.message }, { status: 500 });

  // Re-derive which entity_aliases rows actually connect this group,
  // independent of whatever the client believed — the same normalization
  // catalog-dedupe.ts's own clustering uses, so this can never disagree
  // with what the tool showed.
  const [{ data: catalogRows }, { data: aliasRows }] = await Promise.all([
    admin.from('catalog_entities').select('id, name').in('id', uniqIds),
    admin.from('entity_aliases').select('id, catalog_id, alias').in('catalog_id', uniqIds),
  ]);

  const valuesInGroup = new Map<string, string[]>(); // normalized value -> catalog_ids reaching it (name or alias)
  for (const c of catalogRows ?? []) {
    const n = normalizeName(c.name as string);
    if (n) valuesInGroup.set(n, [...(valuesInGroup.get(n) ?? []), c.id as string]);
  }
  for (const a of aliasRows ?? []) {
    const n = normalizeName(a.alias as string);
    if (n) valuesInGroup.set(n, [...(valuesInGroup.get(n) ?? []), a.catalog_id as string]);
  }

  const aliasIdsToDelete: string[] = [];
  for (const a of aliasRows ?? []) {
    const n = normalizeName(a.alias as string);
    const owners = new Set(valuesInGroup.get(n) ?? []);
    // This alias row is what LINKED the group only if some OTHER member
    // (not the alias's own catalog_id) also lands on the same normalized
    // value — otherwise it is an alias with nothing to do with why this
    // group was ever suggested, and stays untouched (e.g. btov's own
    // legitimate 'b2venture').
    if (owners.size > 1 || (owners.size === 1 && !owners.has(a.catalog_id as string))) {
      aliasIdsToDelete.push(a.id as string);
    }
  }

  if (aliasIdsToDelete.length) {
    const { error: delErr } = await admin.from('entity_aliases').delete().in('id', aliasIdsToDelete);
    if (delErr) return NextResponse.json({ ok: false, error: `Dismissed, but couldn't remove the linking aliases: ${delErr.message}` }, { status: 500 });
  }

  await logAdminAction(admin, {
    adminUserId: userId, action: 'catalog_dedupe_dismiss', subjectType: 'catalog_entity', subjectId: uniqIds[0],
    detail: { groupIds: uniqIds, reason: reason.trim(), removedAliasIds: aliasIdsToDelete },
  });

  return NextResponse.json({ ok: true, dismissedPairs: pairs.length, removedAliases: aliasIdsToDelete.length });
}
