// Prompt 360 Part A — "Market data": GET assembles the gate +
// all three sources; POST saves the founder's own structured "Added by you"
// facts. Fail-closed: the gate is re-checked HERE, not just in the client
// overlay — a request past the gate with missing minimums is refused, same
// "never trust a single layer for a gate" discipline as every other
// mechanical gate in this codebase (checkMiniPitchGate's own server
// enforcement in /api/mini-pitch/route.ts is the precedent).
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { orgMarketDataAvailable, marketResearchItemsAvailable } from '@/lib/market-data-capability';
import { documentExtractionsAvailable } from '@/lib/document-extraction-capability';
import { checkMarketDataGate } from '@/lib/market-data-gate';

async function resolveOrg(sb: Awaited<ReturnType<typeof serverClient>>, userId: string) {
  const { data } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

// Prompt 360 §A1 — "From your documents": extractions whose document lives
// in a folder that reads as market/traction research, or whose own
// extracted documentType says so. Both are heuristics over free text (no
// schema-level "this folder/document is Market Research" tag exists — see
// this route's own research), disclosed here rather than presented as
// precise: a folder the founder happens to name differently just won't
// surface here, which is a false negative, never a false positive that
// shows the wrong document as market evidence.
const MARKET_HEURISTIC = /market|research|sector|industry|competitor/i;

async function marketDocumentItems(admin: SupabaseClient, orgId: string) {
  if (!(await documentExtractionsAvailable())) return [];
  const [{ data: docs }, { data: folders }, { data: extractions }] = await Promise.all([
    admin.from('documents').select('id, name, folder_id').eq('org_id', orgId),
    admin.from('folders').select('id, name').eq('org_id', orgId),
    admin.from('document_extractions').select('document_id, extracted').eq('org_id', orgId).eq('status', 'completed'),
  ]);
  const folderNameById = new Map((folders ?? []).map((f) => [f.id as string, (f.name as string | null) ?? '']));
  const docsById = new Map((docs ?? []).map((d) => [d.id as string, d as { id: string; name: string; folder_id: string | null }]));
  const items: { documentId: string; documentName: string; label: string }[] = [];
  for (const e of (extractions ?? []) as { document_id: string; extracted: Record<string, unknown> }[]) {
    const doc = docsById.get(e.document_id);
    if (!doc) continue;
    const folderName = doc.folder_id ? folderNameById.get(doc.folder_id) ?? '' : '';
    const documentType = typeof e.extracted?.documentType === 'string' ? e.extracted.documentType : '';
    if (!MARKET_HEURISTIC.test(folderName) && !MARKET_HEURISTIC.test(documentType) && !MARKET_HEURISTIC.test(doc.name)) continue;
    for (const p of (e.extracted?.programs as { name: string }[] | undefined) ?? []) {
      items.push({ documentId: doc.id, documentName: doc.name, label: `Program/reference: ${p.name}` });
    }
    for (const d of (e.extracted?.dates as { label: string; date: string }[] | undefined) ?? []) {
      items.push({ documentId: doc.id, documentName: doc.name, label: `${d.label}: ${d.date}` });
    }
    if (items.length === 0 || items[items.length - 1]?.documentId !== doc.id) {
      items.push({ documentId: doc.id, documentName: doc.name, label: documentType || 'Referenced in this document' });
    }
  }
  return items;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const empty = { available: false };
  if (!url || !serviceKey) return NextResponse.json(empty);

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = await resolveOrg(sb, user.id);
  if (!orgId) return NextResponse.json(empty);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const [{ data: org }, { data: claims }, marketDocs, marketDataAvail, researchAvail, docCounts] = await Promise.all([
    admin.from('orgs').select('sectors, sectors_other, stage, one_liner').eq('id', orgId).maybeSingle(),
    admin.from('company_claims').select('id, category, status').eq('org_id', orgId).eq('status', 'accepted'),
    marketDocumentItems(admin, orgId),
    orgMarketDataAvailable(),
    marketResearchItemsAvailable(),
    documentReadCounts(admin, orgId),
  ]);

  const orgRow = (org ?? {}) as { sectors: string[] | null; sectors_other: string | null; stage: string | null; one_liner: string | null };
  const sectors = [...(orgRow.sectors ?? []), orgRow.sectors_other?.trim()].filter(Boolean) as string[];
  const hasMarketOrSolutionClaim = ((claims ?? []) as { category: string }[]).some((c) => c.category === 'mercado_timing' || c.category === 'solucao');
  const gate = checkMarketDataGate({ sectors, stage: orgRow.stage, oneLiner: orgRow.one_liner }, marketDocs.length > 0, hasMarketOrSolutionClaim);

  let addedByYou = null;
  if (gate.eligible && marketDataAvail) {
    const { data } = await admin.from('org_market_data').select('*').eq('org_id', orgId).maybeSingle();
    addedByYou = data ?? null;
  }

  let researchItems: unknown[] = [];
  if (gate.eligible && researchAvail) {
    const { data } = await admin.from('market_research_items')
      .select('id, section, title, detail, source_url, confidence, status, source_kind, document_id, page')
      .eq('org_id', orgId).eq('status', 'pending').order('section', { ascending: true });
    researchItems = data ?? [];
  }

  return NextResponse.json({
    available: true, gate, sectors, stage: orgRow.stage,
    fromYourDocuments: gate.eligible ? marketDocs : [],
    addedByYou, researchItems,
    // Prompt 370 §B — the three-state empty-state contract: docsExtracted
    // === 0 with docsTotal > 0 means "not read yet" (never "nothing
    // found" — that was the false negative the founder caught, since it
    // reads as "we looked and there's nothing" instead of "we haven't
    // looked at all").
    docCounts: { ...docCounts, docsWithMarketContent: marketDocs.length },
  });
}

// Prompt 370 §B — the counts MarketDataPanel needs to tell "nothing
// market-related found in what WAS read" apart from "nothing has been
// read at all yet" (the exact false-negative the founder caught: the old
// copy said the former when the truth was the latter, because malicious-
// scan-gated documents had literally never been extracted).
async function documentReadCounts(admin: SupabaseClient, orgId: string) {
  const [{ count: docsTotal }, { count: docsReadable }, { count: docsExtracted }] = await Promise.all([
    admin.from('documents').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    admin.from('documents').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('malware_scan_status', 'clean'),
    (await documentExtractionsAvailable())
      ? admin.from('document_extractions').select('document_id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'completed')
      : Promise.resolve({ count: 0 }),
  ]);
  return { docsTotal: docsTotal ?? 0, docsReadable: docsReadable ?? 0, docsExtracted: docsExtracted ?? 0 };
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  if (!(await orgMarketDataAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });

  const orgId = await resolveOrg(sb, user.id);
  if (!orgId) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Fail-closed: re-check the gate server-side before accepting a write,
  // never trust that the client only ever shows this form once unlocked.
  const [{ data: org }, { data: claims }, marketDocs] = await Promise.all([
    admin.from('orgs').select('sectors, sectors_other, stage, one_liner').eq('id', orgId).maybeSingle(),
    admin.from('company_claims').select('category').eq('org_id', orgId).eq('status', 'accepted'),
    marketDocumentItems(admin, orgId),
  ]);
  const orgRow = (org ?? {}) as { sectors: string[] | null; sectors_other: string | null; stage: string | null; one_liner: string | null };
  const sectors = [...(orgRow.sectors ?? []), orgRow.sectors_other?.trim()].filter(Boolean) as string[];
  const hasMarketOrSolutionClaim = ((claims ?? []) as { category: string }[]).some((c) => c.category === 'mercado_timing' || c.category === 'solucao');
  const gate = checkMarketDataGate({ sectors, stage: orgRow.stage, oneLiner: orgRow.one_liner }, marketDocs.length > 0, hasMarketOrSolutionClaim);
  if (!gate.eligible) return NextResponse.json({ ok: false, error: 'Complete your company basics first.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as {
    market_size_value_eur?: number | null; market_size_scope?: string | null; market_size_year?: number | null;
    market_size_source?: string | null; growth_pct?: number | null;
    segments?: string[]; competitors?: { name: string; country?: string; stage?: string; funding?: string; note?: string }[];
    free_sources?: { label: string; url: string }[];
  };

  const { error } = await admin.from('org_market_data').upsert({
    org_id: orgId,
    market_size_value_eur: body.market_size_value_eur ?? null,
    market_size_scope: body.market_size_scope ?? null,
    market_size_year: body.market_size_year ?? null,
    market_size_source: body.market_size_source ?? null,
    growth_pct: body.growth_pct ?? null,
    segments: body.segments ?? [],
    competitors: body.competitors ?? [],
    free_sources: body.free_sources ?? [],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'org_id' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
