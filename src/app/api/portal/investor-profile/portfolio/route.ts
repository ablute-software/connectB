// Prompt 746 Phase 1 — the investor's own Portfolio tab: list, add
// manually, remove. Follows the exact shape every other /api/portal/
// investor-profile/* route already uses (serverClient() for auth, a
// service-role `admin` client for the actual read/write, resolveActive
// InvestorMember to find the firm) — see investor-profile/route.ts, which
// this mirrors line for line rather than inventing a second pattern.
//
// Every query below is explicitly scoped to `member.catalog_entity_id` —
// this route uses the SERVICE-ROLE client (bypasses RLS entirely), so the
// investor_portfolio_companies RLS policy is a second, independent gate,
// never the only thing stopping a cross-firm read/write here. Ticket,
// instrument and contact fields are returned to the investor who owns them
// only — this route has no founder- or public-facing caller anywhere in
// the app (founder-privacy root rule, CLAUDE.md).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';
import { validateManualPortfolioInput, detectDuplicateForEdit } from '@/lib/portfolio-import';

const SELECT_COLUMNS = 'id, status, company_name, website, domain, country, stage_at_entry, sectors, '
  + 'ticket_eur, instrument, invested_at, exit_at, exit_type, contact_name, contact_email, '
  + 'linked_org_id, link_status, source, created_at';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ linked: false });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ linked: false });

  const { data, error } = await admin.from('investor_portfolio_companies')
    .select(SELECT_COLUMNS).eq('investor_catalog_entity_id', member.catalog_entity_id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ linked: true, companies: data ?? [] });
}

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

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const validated = validateManualPortfolioInput(body);
  if ('error' in validated) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });

  const { data: created, error } = await admin.from('investor_portfolio_companies')
    .insert({
      ...validated.row,
      investor_catalog_entity_id: member.catalog_entity_id,
      source: 'manual',
      created_by: user.id,
    })
    .select(SELECT_COLUMNS).single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, company: created });
}

export async function DELETE(req: Request) {
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

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });

  // Scoped to this firm's own catalog_entity_id — a bare `.eq('id', id)`
  // would let one firm delete another firm's row by guessing a uuid; RLS
  // would also block it, but this route uses the service-role client
  // specifically so it never depends on RLS alone.
  const { error } = await admin.from('investor_portfolio_companies').delete()
    .eq('id', id).eq('investor_catalog_entity_id', member.catalog_entity_id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// Prompt 753 §F — "cada linha tem de poder ser editada depois". Reuses
// validateManualPortfolioInput (the exact same rules POST already enforces)
// rather than a second copy — the only difference from POST is UPDATE
// instead of INSERT, and that `source`/`created_by`/`created_at`/
// `linked_org_id`/`link_status` are never part of the patch: an edit never
// turns an imported row into a manual one, never changes who added it, and
// Phase 2's reserved linking columns are untouched here same as everywhere
// else in Phase 1.
//
// validated.row always has exit_at/exit_type as null outside status='past'
// (validateManualPortfolioInput's own rule) — applying it as a full-row
// UPDATE, not a partial merge, is what actually clears a stale exit date/
// type when an edit flips a company from Past back to Current; a partial
// patch would have left the old values sitting under the new status.
export async function PATCH(req: Request) {
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

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });

  // Same-shape refusal as every other cross-firm lookup in this app: a row
  // that doesn't exist and one that belongs to another investor answer
  // identically (404), never a 403 that would confirm the id is real.
  const { data: existingRow } = await admin.from('investor_portfolio_companies')
    .select('id').eq('id', id).eq('investor_catalog_entity_id', member.catalog_entity_id).maybeSingle();
  if (!existingRow) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const validated = validateManualPortfolioInput(body);
  if ('error' in validated) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });

  // Non-blocking — the prompt's own "avisa, sem bloquear": checked against
  // every OTHER row this firm has (this row excluded by id), same
  // name-or-domain rule the import path already uses.
  const { data: siblings } = await admin.from('investor_portfolio_companies')
    .select('id, company_name, domain').eq('investor_catalog_entity_id', member.catalog_entity_id).neq('id', id);
  const duplicate = detectDuplicateForEdit(
    { companyName: validated.row.company_name, domain: validated.row.domain },
    id,
    (siblings ?? []).map((s) => ({ id: s.id as string, companyName: s.company_name as string, domain: s.domain as string | null })),
  );

  const { data: updated, error } = await admin.from('investor_portfolio_companies')
    .update({ ...validated.row, updated_at: new Date().toISOString() })
    .eq('id', id).eq('investor_catalog_entity_id', member.catalog_entity_id)
    .select(SELECT_COLUMNS).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  return NextResponse.json({
    ok: true, company: updated,
    duplicateWarning: duplicate ? `Already in your portfolio: ${duplicate.reason === 'domain' ? 'same website as another company' : 'same name as another company'}.` : null,
  });
}
