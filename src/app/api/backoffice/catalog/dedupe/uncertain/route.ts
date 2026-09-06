// Prompt 580b §A.1 — "Not sure" for exactly one pair: unlike "Not the
// same" (dismiss/route.ts), this does NOT remove any entity_aliases and
// does NOT remove the edge from the graph — the pair stays in its group
// (findDuplicateClusters never sees this table's 'uncertain' rows at
// all; only 'not_same' ones are passed in as dismissedPairs), just
// labeled and taken out of automatic-merge consideration until someone
// revisits it. A note is optional ("nota opcional"), unlike a dismissal's
// required reason.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { ids, note } = await req.json().catch(() => ({})) as { ids?: string[]; note?: string };
  if (!ids || ids.length !== 2) return NextResponse.json({ ok: false, error: 'Exactly 2 catalog ids are required.' }, { status: 400 });

  const [a, b] = [...ids].sort();
  const { error } = await admin.from('catalog_dedupe_dismissals')
    .upsert({ a_catalog_id: a, b_catalog_id: b, status: 'uncertain', reason: note?.trim() || null, dismissed_by: userId }, { onConflict: 'a_catalog_id,b_catalog_id' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: userId, action: 'catalog_dedupe_uncertain', subjectType: 'catalog_entity', subjectId: a,
    detail: { pair: [a, b], note: note?.trim() || null },
  });

  return NextResponse.json({ ok: true });
}
