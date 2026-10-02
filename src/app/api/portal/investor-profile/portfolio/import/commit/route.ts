// Prompt 746 Phase 1 — Portfolio CSV/Excel import, commit. Receives the
// plan the CLIENT computed (PortfolioPanel.tsx's ImportFlow calls
// buildPortfolioImportPlan directly — no dry-run round trip exists for this
// feature: the duplicate-detection input it needs, "what does this firm
// already have", is exactly the list the panel already fetched to render
// the table, so a server preview call would just re-fetch data the client
// already has). The client may have toggled some rows' `include` after
// reviewing errors/duplicates in that preview — same "resend the plan"
// shape as api/import/structured/commit/route.ts, just built locally
// instead of by a sibling dry-run route.
//
// This route NEVER trusts that preview as authoritative: it re-derives
// duplicates against the CURRENT database state before inserting anything,
// because the client's snapshot could be stale (a second tab already
// imported the same company since the preview was computed) — see the
// re-check below. Only the parsed `data`/`errors` shape is taken as given;
// even that stays behind `errors.length === 0` so a client bug can only
// ever narrow what gets written, never widen it.
//
// The import never sends an invite: this route inserts rows and nothing
// else — no email, no access_grants row, no catalog_entities write. Phase 2
// is what wires linked_org_id/link_status; this route never sets either
// past its column default.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';
import {
  bucketImportItems, detectDuplicates, duplicateReasonText,
  type DuplicateMatch, type PortfolioCompanyRow, type RowIssue,
} from '@/lib/portfolio-import';

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

  const body = await req.json().catch(() => ({})) as {
    items?: { row: number; data: PortfolioCompanyRow | null; errors: RowIssue[]; include: boolean; duplicate: DuplicateMatch | null }[];
  };
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ ok: false, error: 'Nothing to import.' }, { status: 400 });
  }

  // Prompt AL757 §C — "a faixa diz porquê, linha a linha": every item ends
  // up either inserted or in `skipped` with a human reason, never just a
  // bare count. bucketImportItems is the exact same rule the commit route
  // used to have inlined, pulled into portfolio-import.ts so it's unit-
  // tested directly (this route has no test of its own — it needs a live
  // database). The actual insert decision below never trusts the client's
  // own `duplicate` snapshot — only wording the skip reason does;
  // duplicates against real candidates are re-checked server-side next.
  const { candidates, skipped } = bucketImportItems(body.items);

  if (candidates.length === 0) return NextResponse.json({ ok: true, created: 0, skipped });

  const { data: existing, error: existingErr } = await admin.from('investor_portfolio_companies')
    .select('company_name, domain').eq('investor_catalog_entity_id', member.catalog_entity_id);
  if (existingErr) return NextResponse.json({ ok: false, error: existingErr.message }, { status: 500 });

  const dups = detectDuplicates(
    candidates.map((c) => ({ row: c.row, companyName: c.data.companyName, domain: c.data.domain })),
    (existing ?? []).map((e) => ({ companyName: e.company_name as string, domain: e.domain as string | null })),
  );

  const toInsert = candidates.filter((c) => !dups.has(c.row));
  for (const c of candidates) {
    const d = dups.get(c.row);
    if (d) skipped.push({ row: c.row, reason: duplicateReasonText(d) });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ ok: true, created: 0, skipped });
  }

  const rows = toInsert.map((c) => ({
    investor_catalog_entity_id: member.catalog_entity_id,
    source: 'import' as const,
    created_by: user.id,
    status: c.data.status,
    company_name: c.data.companyName,
    website: c.data.website ?? null,
    domain: c.data.domain,
    country: c.data.country ?? null,
    stage_at_entry: c.data.stageAtEntry ?? null,
    sectors: c.data.sectors,
    ticket_eur: c.data.ticketEur ?? null,
    instrument: c.data.instrument ?? null,
    invested_at: c.data.investedAt ?? null,
    exit_at: c.data.exitAt ?? null,
    exit_type: c.data.exitType ?? null,
    contact_name: c.data.contactName ?? null,
    contact_email: c.data.contactEmail ?? null,
    contact_phone: c.data.contactPhone ?? null,
  }));

  const { error: insertErr, count } = await admin.from('investor_portfolio_companies')
    .insert(rows, { count: 'exact' });
  if (insertErr) return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, created: count ?? rows.length, skipped });
}
