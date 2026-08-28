// Prompt 439 §4 — Sherlock Prep report: founder-only, read-only. Assembles
// the flat SherlockPrepSources snapshot sherlockPrep() needs and hands it
// straight to that pure engine — no matching logic lives here.
//
// Privacy, both directions (§4's own note): nothing in this report ever
// reaches an investor-facing surface (the investor never learns the
// startup "prepared"), and the report itself never contains anything
// about any investor — zero reference to requests, scores, or investor
// activity (CLAUDE.md root rule). document_extractions in particular is
// founder-only by construction (its own table comment says so) and this
// route is founder-only, but the boundary is still worth restating here:
// never let this route's output flow into anything investor-visible.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { readKnowledgeSources } from '@/lib/company-knowledge-db';
import { readItems } from '@/lib/roadmap-categories';
import { documentRefsAvailable, documentExtractionsAvailable } from '@/lib/document-extraction-capability';
import { orgMarketRingsAvailable, orgCompetitorsAvailable, marketResearchItemsAvailable } from '@/lib/market-data-capability';
import { sherlockPrep, type SherlockPrepSources } from '@/lib/sherlock-prep';
import type { ClaimCategory, CompanyPhase } from '@/lib/types';

async function readAcceptedClaims(admin: SupabaseClient, orgId: string): Promise<SherlockPrepSources['claims']> {
  const withRefs = await documentRefsAvailable();
  // Two literal .select() calls, not one string built from a ternary —
  // postgrest-js infers the result row type from the SELECT string's own
  // literal type, not its runtime value (same constraint documented
  // throughout this codebase's cap-table/dossier routes).
  const { data } = withRefs
    ? await admin.from('company_claims').select('id, category, statement, evidence_class, document_refs').eq('org_id', orgId).eq('status', 'accepted')
    : await admin.from('company_claims').select('id, category, statement, evidence_class').eq('org_id', orgId).eq('status', 'accepted');
  return ((data ?? []) as unknown as { id: string; category: ClaimCategory; statement: string; evidence_class: number; document_refs?: { documentId: string }[] }[])
    .map((c) => ({
      id: c.id, category: c.category, statement: c.statement, evidence_class: c.evidence_class,
      document_refs: withRefs ? (c.document_refs ?? []).map((r) => ({ documentId: r.documentId })) : [],
    }));
}

async function readExtractions(admin: SupabaseClient, orgId: string): Promise<SherlockPrepSources['extractions']> {
  if (!(await documentExtractionsAvailable())) return [];
  const { data } = await admin.from('document_extractions').select('document_id, extracted').eq('org_id', orgId).eq('status', 'completed');
  return ((data ?? []) as { document_id: string; extracted: { documentType?: string | null; programs?: { name: string }[]; isSigned?: boolean | null } }[])
    .map((e) => ({
      documentId: e.document_id,
      documentType: e.extracted?.documentType ?? null,
      programs: (e.extracted?.programs ?? []).map((p) => ({ label: p.name })),
      isSigned: e.extracted?.isSigned ?? null,
    }));
}

async function countRows(admin: SupabaseClient, table: string, orgId: string, extraEq?: [string, string]): Promise<number> {
  let query = admin.from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId);
  if (extraEq) query = query.eq(extraEq[0], extraEq[1]);
  const { count } = await query;
  return count ?? 0;
}

async function readMarketCounts(admin: SupabaseClient, orgId: string): Promise<SherlockPrepSources['market']> {
  const [rings, competitors, trends, regulatory] = await Promise.all([
    orgMarketRingsAvailable().then((ok) => (ok ? countRows(admin, 'org_market_rings', orgId) : 0)),
    orgCompetitorsAvailable().then((ok) => (ok ? countRows(admin, 'org_competitors', orgId) : 0)),
    // Only 'accepted' — a 'pending' research item hasn't been founder-
    // reviewed yet (could be AI-wrong), 'rejected' was explicitly
    // discarded; same conservative bar as everything else in this engine.
    marketResearchItemsAvailable().then((ok) => (ok ? countRows(admin, 'market_research_items', orgId, ['section', 'trends']) : 0)),
    marketResearchItemsAvailable().then((ok) => (ok ? countRows(admin, 'market_research_items', orgId, ['section', 'regulatory']) : 0)),
  ]);
  return { rings, competitors, trends, regulatory };
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ available: false });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const [knowledge, { data: orgRow }, claims, documentsResult, extractions, tractionResult, market, capTableResult] = await Promise.all([
    readKnowledgeSources(admin, orgId),
    admin.from('orgs').select('current_phase').eq('id', orgId).maybeSingle(),
    readAcceptedClaims(admin, orgId),
    admin.from('documents').select('id, name').eq('org_id', orgId),
    readExtractions(admin, orgId),
    admin.from('org_traction_metrics').select('id, label, value').eq('org_id', orgId),
    readMarketCounts(admin, orgId),
    admin.from('cap_table_entries').select('id, category').eq('org_id', orgId),
  ]);

  const sources: SherlockPrepSources = {
    claims,
    documents: (documentsResult.data ?? []) as { id: string; name: string }[],
    extractions,
    tractionMetrics: (tractionResult.data ?? []) as { id: string; label: string; value: string }[],
    roadmapMilestones: knowledge.milestones.map((m) => ({
      id: m.id, period_year: m.period_year,
      items: readItems(m).map((i) => i.text).filter((t) => t.trim().length > 0),
    })),
    people: knowledge.people.map((p) => ({ id: p.id, full_name: p.full_name, title: p.title ?? null, is_founder: p.is_founder ?? false, bio: p.bio ?? null })),
    fundingRounds: knowledge.fundingRounds.map((f) => ({ id: f.id, label: f.label ?? 'Funding round' })),
    market,
    capTableEntries: (capTableResult.data ?? []) as { id: string; category: string }[],
    clarifications: knowledge.clarifications.map((c) => ({ id: c.id })),
  };

  // orgs.current_phase — the same field BARS' own investor-side already
  // reads; defaults to 'concept_idea' when unset, same fallback used
  // throughout the BARS drawer/panel code.
  const companyPhase = ((orgRow as { current_phase?: CompanyPhase | null } | null)?.current_phase ?? 'concept_idea') as CompanyPhase;

  const report = sherlockPrep(sources, companyPhase);
  return NextResponse.json({ available: true, report });
}
