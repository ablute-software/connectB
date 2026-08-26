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

// Prompt 370 §C3 — a document-sourced item in one of these three sections
// auto-fills org_market_data (the "Added by you" form) instead of becoming
// a claim: the founder corrects a pre-filled number/name instead of typing
// it from scratch. trends/regulatory (and any web item) have no dedicated
// org_market_data field, so those still become a claim below, unchanged.
//
// Prompt 384 §E.2 — `players` used to be in this set too (document-sourced
// only), merging into org_market_data.competitors — the OLD free-text list,
// separate from the real structured one (org_competitors) CompetitorsCard's
// own "Add" button already wrote to. Two write paths for "accept this
// competitor" is exactly the bug §E exists to close, so `players` (document
// OR web) now always takes the SAME structured, deduped path — see the
// dedicated branch below instead of this set.
const AUTO_FILL_SECTIONS = new Set(['sizing', 'growth', 'segments']);

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
    const structuredName = (item.structured as { name?: string } | null)?.name;
    const name = (structuredName ?? item.title.replace(/^Competitor:\s*/i, '')).trim();
    if (!name) return NextResponse.json({ ok: false, error: 'This item has no competitor name to add.' }, { status: 400 });
    const sourceUrl = item.source_url ?? (item.document_id ? vaultCitation(item.document_id as string, null) : undefined);
    try {
      await addOrUpdateCompetitor(admin, orgId, {
        name, description: item.detail || undefined, sourceUrl,
        sourceQuality: item.source_kind === 'document' ? 'founder_document' : 'secondary',
        addedBy: 'ai',
      });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
    const { error } = await admin.from('market_research_items')
      .update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', body.id).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, appliedTo: 'org_competitors' });
  }

  // Prompt 370 §C3 — document items in an auto-fill section merge straight
  // into org_market_data (the manual form the founder would otherwise type
  // into from scratch) instead of becoming a claim.
  if (item.source_kind === 'document' && AUTO_FILL_SECTIONS.has(item.section as string) && item.structured && (await orgMarketDataAvailable())) {
    const s = item.structured as Record<string, unknown>;
    const { data: current } = await admin.from('org_market_data').select('*').eq('org_id', orgId).maybeSingle();
    const patch: Record<string, unknown> = { org_id: orgId, updated_at: new Date().toISOString() };
    if (item.section === 'sizing') {
      if (typeof s.valueEur === 'number') patch.market_size_value_eur = s.valueEur;
      if (typeof s.scope === 'string') patch.market_size_scope = s.scope;
      if (typeof s.year === 'number') patch.market_size_year = s.year;
      patch.market_size_source = `From your documents (${item.title})`;
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
