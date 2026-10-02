// Prompt AL759 §C — move companies between Current and Past, many at once.
// A route of its own, not a stretched PATCH: PATCH revalidates and replaces a
// whole row (validateManualPortfolioInput), which is the wrong tool for
// "flip the status of 30 rows" — and has no place to say "clear the exit
// data when going back to Current".
//
// Same guards as every other Portfolio route: not-viewer, signed in, and an
// active investor firm. Every id is checked against THAT firm in the same
// statement that updates it (`investor_catalog_entity_id = me`): an id that
// belongs to another firm, or does not exist, simply matches nothing — no
// 403, no error, and it never shows up in `moved`, so the response cannot be
// used to probe which ids exist.
//
// One UPDATE, so it is all-or-nothing. A 500-id `in.(...)` filter is an
// ~18.6 KB URL; probed against the real REST gateway before relying on it
// (it reaches PostgREST, which is where the 401/42501 for an anonymous
// caller came from), not assumed.
//
// Only status and updated_at change — plus exit_at/exit_type -> null when
// the destination is Current, the same rule validateManualPortfolioInput
// already imposes (exit data exists only on Past rows). source, created_at,
// linked_org_id and link_status are never touched. No migration.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';
import { validateMoveBody } from '@/lib/portfolio-table';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const validated = validateMoveBody(body);
  if ('error' in validated) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  const { ids, to } = validated;

  // How many of THESE rows (this firm's only) are about to lose exit data —
  // read before the update, since the update itself nulls it. Only needed for
  // Current; moving to Past changes nothing a person would miss.
  let clearedExitData = 0;
  if (to === 'current') {
    const { data: owned, error: readErr } = await admin.from('investor_portfolio_companies')
      .select('id, exit_at, exit_type').in('id', ids).eq('investor_catalog_entity_id', member.catalog_entity_id);
    if (readErr) return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
    clearedExitData = (owned ?? []).filter((r) => r.exit_at || r.exit_type).length;
  }

  const patch: Record<string, unknown> = { status: to, updated_at: new Date().toISOString() };
  if (to === 'current') { patch.exit_at = null; patch.exit_type = null; }

  const { data: updated, error } = await admin.from('investor_portfolio_companies')
    .update(patch).in('id', ids).eq('investor_catalog_entity_id', member.catalog_entity_id).select('id');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const moved = (updated ?? []).length;
  return NextResponse.json({ ok: true, moved, clearedExitData: moved === 0 ? 0 : clearedExitData });
}
