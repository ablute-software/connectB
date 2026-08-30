// Prompt 360 §A2 — curation, item by item: "Accept" turns a Sherlock
// research item into a real company_claims row (category mercado_timing,
// sourceKind 'web_research', sourceRef the source URL) — so it feeds
// mini-pitch/Blueprint/the gap-interrogation engine without any new wiring,
// same reuse-not-reinvent reasoning as document-extraction-linking.ts's own
// proposeClaimFromDocumentFact. "Reject" just marks it rejected —
// unique(org_id, section, title) then keeps it from ever being re-proposed
// under the same research signature.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { marketResearchItemsAvailable, orgMarketDataAvailable } from '@/lib/market-data-capability';
import { claimsAvailable } from '@/lib/blueprint-capability';
import { normalizeAtom } from '@/lib/company-claims';
import { addOrUpdateCompetitor } from '@/lib/market-competitor-write';
import { vaultCitation } from '@/lib/market-rings';
import { shouldAutoFillMarketData } from '@/lib/market-research-structured';
import type { CompetitorClassification } from '@/lib/market-competition';

// Prompt 370 §C3 / Prompt 447 §C — an item in an auto-fill section merges
// straight into org_market_data (the "Added by you" form) instead of
// becoming a claim: the founder corrects a pre-filled number/name instead
// of typing it from scratch. shouldAutoFillMarketData (market-research-
// structured.ts) has the real gate logic, tested directly — sizing/growth
// now qualify regardless of source (every item reaching 'pending' there
// has validated `structured` since 445), `segments` stays document-only
// (no web equivalent this phase, §F). trends/regulatory have no dedicated
// org_market_data field, so those still become a claim below, unchanged.
// `rounds` deliberately falls through too — no single field to fill; the
// comparable-rounds merge (market-rounds-merge.ts, read from
// /api/market-data/competitors) reads `structured` directly off accepted
// rows instead, needing no extra write here.
//
// Prompt 384 §E.2 — `players` used to be auto-fill-eligible too (document-
// sourced only), merging into org_market_data.competitors — the OLD free-
// text list, separate from the real structured one (org_competitors)
// CompetitorsCard's own "Add" button already wrote to. Two write paths for
// "accept this competitor" is exactly the bug §E exists to close, so
// `players` (document OR web) now always takes the SAME structured,
// deduped path — see the dedicated branch below instead.

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  if (!(await marketResearchItemsAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });

  const body = await req.json().catch(() => ({})) as { id?: string; action?: 'accept' | 'reject' };
  if (!body.id || (body.action !== 'accept' && body.action !== 'reject')) {
    return NextResponse.json({ ok: false, error: 'id and action are required.' }, { status: 400 });
  }

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: item } = await admin.from('market_research_items')
    .select('id, section, title, detail, source_url, source_kind, structured, document_id').eq('id', body.id).eq('org_id', orgId).eq('status', 'pending').maybeSingle();
  if (!item) return NextResponse.json({ ok: false, error: 'Item not found.' }, { status: 404 });

  if (body.action === 'reject') {
    const { error } = await admin.from('market_research_items').update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', body.id).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Prompt 384 §E.2 — `players`, document OR web, always becomes a real
  // structured competitor (org_competitors + the shared market_companies
  // library, deduped by domain/name) — the same path CompetitorsCard's own
  // "Add" button already uses, never the old org_market_data.competitors
  // free-text merge. structured.name is the extraction's own parsed
  // company name when present (document pass); a web item has no
  // `structured`, so it falls back to the title with the "Competitor: "
  // prefix stripped, same fallback CompetitorsCard.tsx's client-side
  // acceptSuggestionAsCompetitor already applies for the identical case.
  if (item.section === 'players') {
    // Prompt 448 §C — `structured` has two different shapes depending on
    // provenance (document extraction: { name, ... }; web research since
    // 445: { company, competitorType }), but either way a competitor name
    // must come from structured data, never from the display title. The
    // title fallback this branch used to have (Prompt 447 §A) let ~26
    // pre-445 web items (structured: null) resolve to whatever the title
    // happened to say — confirmed in production to include wrong names
    // (FLUIDINOVA, Gazelle Wind Power, ...). An item with no structured
    // name is unverifiable and stays that way permanently — there is no
    // path back to add it once this fallback is gone. This is the second
    // of two independent layers: market-data/route.ts §A already stops
    // serving these items to the UI at all; this layer refuses them even
    // if something calls this endpoint directly, bypassing the UI.
    const structured = item.structured as { name?: string; company?: string; sherlockClassification?: CompetitorClassification } | null;
    const structuredName = structured?.name ?? structured?.company;
    if (!structuredName) {
      return NextResponse.json({
        ok: false,
        error: 'Cannot accept this suggestion: no structured competitor data behind it. This item predates structured research and can no longer be verified — it stays visible nowhere and cannot be accepted.',
      }, { status: 409 });
    }
    // Prompt 450 §C — Sherlock's own deterministic classifier (never the
    // model) decides whether a candidate can become a real competitor row.
    // A ruled-out, unresolved, or status-quo candidate stays visible
    // elsewhere (so the founder can see WHY) but can never be accepted.
    //
    // Prompt 478 — this gate USED to be a no-op for document-sourced items,
    // because they never carried sherlockClassification at all. That was
    // the defect 478 fixed (13 competitors in production, 0 classified, 10
    // of them from documents), so the gate is now live for BOTH provenances
    // — which is the point: an entry describing the buyer's current
    // behaviour is not a competitor whether it was read off a web page or
    // out of the founder's own deck. Two consequences worth knowing before
    // reading a 409 here as a bug:
    //   - a document candidate the model DID describe well enough to
    //     classify can now be refused acceptance, where before it would
    //     have been accepted with competitor_type null;
    //   - a document candidate whose facets are missing or unusable still
    //     carries no classification (parseCompetitiveRelation returns null),
    //     so this gate stays a no-op for it and it is accepted exactly as
    //     it is today — the no-regression case Prompt 478 §5 protects.
    const classification = structured?.sherlockClassification ?? null;
    if (classification === 'NOT_COMPETITOR') {
      return NextResponse.json({ ok: false, error: 'Sherlock could not establish a competitive relationship for this candidate.' }, { status: 409 });
    }
    if (classification === 'UNRESOLVED') {
      return NextResponse.json({ ok: false, error: 'Not enough evidence yet to classify this candidate — it needs more research before it can become a competitor.' }, { status: 409 });
    }
    if (classification === 'STATUS_QUO') {
      return NextResponse.json({ ok: false, error: 'This entry describes the buyer\'s current behavior, not a company — it cannot be added to Competitors.' }, { status: 409 });
    }
    const name = structuredName.trim();
    const sourceUrl = item.source_url ?? (item.document_id ? vaultCitation(item.document_id as string, null) : undefined);
    try {
      await addOrUpdateCompetitor(admin, orgId, {
        name, description: item.detail || undefined, sourceUrl,
        sourceQuality: item.source_kind === 'document' ? 'founder_document' : 'secondary',
        addedBy: 'ai', competitorType: classification,
      });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
    const { error } = await admin.from('market_research_items')
      .update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', body.id).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, appliedTo: 'org_competitors' });
  }

  if (item.structured && (await orgMarketDataAvailable()) && shouldAutoFillMarketData(item.section as string, item.source_kind as string | null)) {
    const s = item.structured as Record<string, unknown>;
    const { data: current } = await admin.from('org_market_data').select('*').eq('org_id', orgId).maybeSingle();
    const patch: Record<string, unknown> = { org_id: orgId, updated_at: new Date().toISOString() };
    if (item.section === 'sizing') {
      if (typeof s.valueEur === 'number') patch.market_size_value_eur = s.valueEur;
      if (typeof s.scope === 'string') patch.market_size_scope = s.scope;
      if (typeof s.year === 'number') patch.market_size_year = s.year;
      // Prompt 447 §C — never attribute a document-sourced label to a web
      // finding, or vice versa.
      patch.market_size_source = item.source_kind === 'document' ? `From your documents (${item.title})` : `From Sherlock research (${item.title})`;
    } else if (item.section === 'growth' && typeof s.pct === 'number') {
      patch.growth_pct = s.pct;
    } else if (item.section === 'segments' && typeof s.name === 'string') {
      const existingSegments = (current?.segments as string[] | undefined) ?? [];
      patch.segments = existingSegments.includes(s.name) ? existingSegments : [...existingSegments, s.name];
    }
    const { error: upsertError } = await admin.from('org_market_data').upsert(patch, { onConflict: 'org_id' });
    if (upsertError) return NextResponse.json({ ok: false, error: upsertError.message }, { status: 500 });

    const { error } = await admin.from('market_research_items')
      .update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', body.id).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, appliedTo: 'org_market_data' });
  }

  let claimId: string | null = null;
  if (await claimsAvailable()) {
    const statement = `${item.title}. ${item.detail}`.trim();
    // Prompt 370 — a document-sourced item (trends/regulatory) is
    // literally backed by a Vault document, which is exactly what
    // sourceKind 'vault_doc' means elsewhere in this schema — distinct
    // from 'web_research' (a real web citation, no Vault document behind
    // it at all).
    const sourceKind = item.source_kind === 'document' ? 'vault_doc' : 'web_research';
    const sourceRef = item.source_kind === 'document' ? `document:${item.document_id ?? ''}` : (item.source_url ?? undefined);
    const n = normalizeAtom({ category: 'mercado_timing', statement, sourceKind, sourceRef });
    const { data: claim, error: claimError } = await admin.from('company_claims').insert({
      org_id: orgId, category: n.category, statement: n.statement,
      evidence_class: n.evidenceClass, specificity: n.specificity,
      source_kind: n.sourceKind, source_ref: n.sourceRef ?? null, status: 'accepted',
    }).select('id').single();
    if (claimError) return NextResponse.json({ ok: false, error: claimError.message }, { status: 500 });
    claimId = (claim?.id as string | undefined) ?? null;
  }

  const { error } = await admin.from('market_research_items')
    .update({ status: 'accepted', created_claim_id: claimId, updated_at: new Date().toISOString() })
    .eq('id', body.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, claimId });
}
