// Prompt 852 §A/§B — the ONE write path for the startup's own "not a fit for
// us" (startup_investor_decisions, migration 0338). Create, edit the note,
// revert. Everything is gated on the `investor_decisions` capability
// (org-permissions.ts), checked with canWithMatrix exactly as
// /api/company/matchdeal/publish checks org_editing.
//
// FOUNDER-PRIVATE, ABSOLUTELY. Nothing this route writes may reach any
// investor surface — not the note, not its existence, not a count. The
// record has no investor-facing reader at all: the table's only consumers
// are the founder's own Pipeline (org-scoped RLS) and the back-office
// Insight tab (service role, is_platform_admin). CLAUDE.md's root rule
// applies in this direction too.
//
// It deliberately does NOT write an `interactions` row, does NOT touch
// entities.status and does NOT create a rejection_code — see
// startup-investor-decision.ts for why that separation is the whole point.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { canWithMatrix } from '@/lib/org-permissions';
import { loadOrgMatrix } from '@/lib/org-matrix-server';
import type { OrgRole } from '@/lib/permissions';
import { PASS_REASON_CATEGORIES } from '@/lib/relationship';
import { noteProblem, noteProblemMessage } from '@/lib/startup-investor-decision';

type Action = 'create' | 'update' | 'revert';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    action?: Action; entityId?: string; decisionId?: string; note?: string; reasonCategory?: string | null;
  };
  const action = body.action;
  if (action !== 'create' && action !== 'update' && action !== 'revert') {
    return NextResponse.json({ ok: false, error: 'action must be create, update or revert.' }, { status: 400 });
  }

  const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const matrix = await loadOrgMatrix(admin, member.org_id as string);
  if (!canWithMatrix(matrix, member.role as OrgRole, 'investor_decisions')) {
    return NextResponse.json({ ok: false, error: 'Your role can’t record decisions about investors.' }, { status: 403 });
  }

  const now = new Date().toISOString();

  if (action === 'revert') {
    // Reverting never deletes: the row stays, and the back-office shows it
    // struck through with the revert date. The partial unique index frees
    // the (org, entity) slot the moment reverted_at is set, so the founder
    // can record a new decision later without rewriting the old one.
    const { data: row } = await admin.from('startup_investor_decisions')
      .select('id, org_id, reverted_at').eq('id', body.decisionId ?? '').maybeSingle();
    if (!row || row.org_id !== member.org_id) return NextResponse.json({ ok: false, error: 'Decision not found.' }, { status: 404 });
    if (row.reverted_at) return NextResponse.json({ ok: true, alreadyReverted: true });
    const { error } = await admin.from('startup_investor_decisions')
      .update({ reverted_at: now, reverted_by: user.id, updated_at: now, updated_by: user.id })
      .eq('id', row.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // The same validator the form runs, so a note the browser accepted can
  // never be the one Postgres rejects (the CHECK is the backstop, not the
  // error message the founder should ever see).
  const problem = noteProblem(body.note);
  if (problem) return NextResponse.json({ ok: false, error: noteProblemMessage(problem) }, { status: 400 });
  const note = (body.note ?? '').trim();

  const reasonCategory = body.reasonCategory?.trim() || null;
  if (reasonCategory && !(PASS_REASON_CATEGORIES as string[]).includes(reasonCategory)) {
    return NextResponse.json({ ok: false, error: 'Unknown reason category.' }, { status: 400 });
  }

  if (action === 'update') {
    const { data: row } = await admin.from('startup_investor_decisions')
      .select('id, org_id').eq('id', body.decisionId ?? '').maybeSingle();
    if (!row || row.org_id !== member.org_id) return NextResponse.json({ ok: false, error: 'Decision not found.' }, { status: 404 });
    const { error } = await admin.from('startup_investor_decisions')
      .update({ note, reason_category: reasonCategory, updated_at: now, updated_by: user.id })
      .eq('id', row.id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // create
  const entityId = body.entityId;
  if (!entityId) return NextResponse.json({ ok: false, error: 'entityId is required.' }, { status: 400 });
  const { data: entity } = await admin.from('entities').select('id, org_id').eq('id', entityId).maybeSingle();
  if (!entity || entity.org_id !== member.org_id) {
    return NextResponse.json({ ok: false, error: 'Investor not found in your pipeline.' }, { status: 404 });
  }

  // Resolved here, once, so the back-office can group by the REAL firm even
  // across orgs. Null for an entity added by hand that never came from the
  // catalog — never guessed by name.
  const { data: delivery } = await admin.from('catalog_deliveries')
    .select('catalog_id').eq('entity_id', entityId).maybeSingle();

  const { data: created, error } = await admin.from('startup_investor_decisions').insert({
    org_id: member.org_id,
    entity_id: entityId,
    catalog_entity_id: (delivery?.catalog_id as string | undefined) ?? null,
    decision: 'not_a_fit',
    reason_category: reasonCategory,
    note,
    decided_by: user.id,
    decided_at: now,
    updated_at: now,
    updated_by: user.id,
  }).select('*').maybeSingle();

  if (error) {
    // The partial unique index is the real guard against a double-click or
    // two teammates acting at once: one live decision per (org, entity).
    const duplicate = error.message.includes('startup_investor_decisions_live_uniq');
    return NextResponse.json({
      ok: false,
      error: duplicate ? 'This investor already has a live decision — revert it first.' : error.message,
    }, { status: duplicate ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, decision: created });
}
