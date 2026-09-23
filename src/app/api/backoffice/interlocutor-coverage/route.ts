// Prompt 728 §5 — "é o número que decide quando a promoção automática por
// afinidade passa a fazer sentido. Ler da base, não estimar." Read live,
// same definition of "active wave opportunity" the prompt's own
// verification used (entities.wave = 1, status = 'not_contacted') — per
// org and globally.
//
// Three tiers, in increasing strictness:
//   hasHook          — ≥1 contactable person has ANY hook text on file.
//   hasHookWithSource — ≥1 contactable person's hook is hook_status=
//                       'researched' (per catalog-materialize.ts's own
//                       discipline, that status is only ever set when a
//                       real source existed — see relationship.ts's
//                       recommendInterlocutor comment for why no separate
//                       hook_source column is needed on `people` itself
//                       to make this reading honest for a MATERIALIZED
//                       person; a hand-typed hook on an older row could in
//                       principle be marked 'researched' without going
//                       through that discipline — reported as a caveat,
//                       not silently assumed watertight).
//   hasAnySource      — ≥1 contactable person has SOME source of contact
//                       info at all (linkedin_url, a verified email, or a
//                       guessed email) — the closest honest reading of
//                       "fontes guardadas" available on `people` today;
//                       there is no dedicated "sources" column on this
//                       table (sources live on the catalog side, not on a
//                       materialized org-scoped person) — this is a
//                       disclosed interpretation, not a literal field.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

interface EntityRow { id: string; org_id: string }
interface PersonRow { entity_id: string; do_not_contact: boolean; hook: string | null; hook_status: string; linkedin_url: string | null; email_verified: string | null; email_guess: string | null }

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: orgRows } = await admin.from('orgs').select('id, name');
  const orgNameById = new Map(((orgRows ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));

  const { data: entities } = await admin.from('entities')
    .select('id, org_id').eq('wave', 1).eq('status', 'not_contacted');
  const entityRows = (entities ?? []) as EntityRow[];
  if (entityRows.length === 0) {
    return NextResponse.json({ ok: true, global: emptyCounts(), byOrg: [] });
  }

  const { data: people } = await admin.from('people')
    .select('entity_id, do_not_contact, hook, hook_status, linkedin_url, email_verified, email_guess')
    .in('entity_id', entityRows.map((e) => e.id));
  const peopleByEntity = new Map<string, PersonRow[]>();
  for (const p of (people ?? []) as PersonRow[]) {
    if (p.do_not_contact) continue;
    peopleByEntity.set(p.entity_id, [...(peopleByEntity.get(p.entity_id) ?? []), p]);
  }

  const byOrgId = new Map<string, EntityRow[]>();
  for (const e of entityRows) byOrgId.set(e.org_id, [...(byOrgId.get(e.org_id) ?? []), e]);

  const global = countCoverage(entityRows, peopleByEntity);
  const byOrg = [...byOrgId.entries()].map(([orgId, orgEntities]) => ({
    orgId, orgName: orgNameById.get(orgId) ?? orgId,
    ...countCoverage(orgEntities, peopleByEntity),
  })).sort((a, b) => b.total - a.total);

  return NextResponse.json({ ok: true, global, byOrg });
}

function emptyCounts() {
  return { total: 0, withHook: 0, withHookAndSource: 0, withAnySource: 0 };
}

function countCoverage(entities: EntityRow[], peopleByEntity: Map<string, PersonRow[]>) {
  let withHook = 0, withHookAndSource = 0, withAnySource = 0;
  for (const e of entities) {
    const people = peopleByEntity.get(e.id) ?? [];
    if (people.some((p) => !!p.hook)) withHook++;
    if (people.some((p) => p.hook_status === 'researched' && !!p.hook)) withHookAndSource++;
    if (people.some((p) => !!p.linkedin_url || !!p.email_verified || !!p.email_guess)) withAnySource++;
  }
  return { total: entities.length, withHook, withHookAndSource, withAnySource };
}
