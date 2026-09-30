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
import { validateManualPortfolioInput } from '@/lib/portfolio-import';

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
