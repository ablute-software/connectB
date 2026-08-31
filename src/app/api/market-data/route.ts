// Prompt 360 Part A — "Market data": GET assembles the gate +
// all three sources; POST saves the founder's own structured "Added by you"
// facts. Fail-closed: the gate is re-checked HERE, not just in the client
// overlay — a request past the gate with missing minimums is refused, same
// "never trust a single layer for a gate" discipline as every other
// mechanical gate in this codebase (checkMiniPitchGate's own server
// enforcement in /api/mini-pitch/route.ts is the precedent).
//
// Prompt 373 §0.1 — this data is no longer permanently founder-only; it CAN
// reach an investor, but only through the separate, explicit publish path
// (/api/market-data/visibility + dossier-fetch.ts's own market block),
// never through this route. This route stays exactly what it always was —
// the founder's own read/write surface — it just isn't the last word on
// investor visibility any more.
import { isSupersededByTypedFacts } from '@/lib/market-legacy-typed-items';
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
      // Prompt 378 §C — `structured` carries the extraction's own parsed
      // fields (a competitor's exact name, a sizing figure's value/scope/
      // year). The Competitors card uses it to add a card under the real
      // company name rather than re-deriving it from the display title.
      //
      // Prompt 448 §A — filtered by valid provenance, not just
      // hypothesis_id: a bare `hypothesis_id not null` would ALSO hide
      // legitimate document-sourced items (market-document-extract.ts),
      // which never have and never will have a hypothesis_id — document
      // extraction runs per document, not per hypothesis, and always has a
      // real structured.name from the founder's own upload. This keeps:
      // everything document-sourced (always), everything post-445 web
      // research (always has hypothesis_id). Hides: only the ~26 pre-445
      // web `players` items confirmed in production (structured: null,
      // hypothesis_id: null, source_kind: 'web') — the exact lot that
      // resolved to wrong names (FLUIDINOVA, Gazelle Wind Power, etc.) via
      // the old title fallback. Nothing is deleted — "if it exists it's
      // authentic" — this route just stops serving that one lot.
      .select('id, section, title, detail, source_url, confidence, status, source_kind, document_id, page, structured')
      .eq('org_id', orgId).eq('status', 'pending')
      .or('source_kind.eq.document,hypothesis_id.not.is.null')
      .order('section', { ascending: true });
    // Prompt 488 §1 — the growth/sizing cards Prompt 467 replaced and nobody
    // retired. Same discipline as the lot just above: nothing is deleted,
    // nothing is relabelled, this route simply stops offering them as
    // decisions the founder has to make one by one. Filtered here rather
    // than in the query because the condition is a pair of columns, and it
    // belongs in a tested function rather than a PostgREST string — see
    // market-legacy-typed-items.ts for the measurement and the trade-off.
    const served = (data ?? []).filter((r) => !isSupersededByTypedFacts({
      section: (r as { section: string }).section,
      sourceKind: (r as { source_kind: string | null }).source_kind,
    }));
    const rows = served as { document_id: string | null }[];
    // Prompt 463 §A — resolve names HERE, from `documents` (the table a
    // name actually lives in), in one query for every distinct id — never
    // by asking the client to cross-reference against `fromYourDocuments`,
    // a list built from document_extractions for a different purpose whose
    // composition doesn't cover a document-link read (Prompt 462): that
    // mismatch is exactly why the ablute_ deck's own 32 items fell back to
    // the generic "Vault document" label in production.
    const docIds = [...new Set(rows.map((r) => r.document_id).filter((id): id is string => !!id))];
    const namesById = new Map<string, string>();
    if (docIds.length > 0) {
      const { data: namedDocs } = await admin.from('documents').select('id, name').in('id', docIds);
      for (const d of (namedDocs ?? []) as { id: string; name: string }[]) namesById.set(d.id, d.name);
    }
    researchItems = rows.map((r) => ({ ...r, documentName: r.document_id ? namesById.get(r.document_id) ?? null : null }));
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
    // Prompt 375 — 'local_only' documents are just as readable by the app
    // itself as 'clean' ones (see document-extraction-pipeline.ts's gate).
    admin.from('documents').select('id', { count: 'exact', head: true }).eq('org_id', orgId).in('malware_scan_status', ['clean', 'local_only']),
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

  // PROMPT 493, Decision 2 — org_market_data is the FOUNDER'S CLAIM side of
  // Bloco 5 (North Star §8, Milestone D). Recorded here, at the shape the
  // founder actually writes through, before any comparison engine exists.
  //
  // The alternative considered and rejected: company_claims (migration 0176,
  // type CompanyClaim in types.ts, Prompt 219) is the pitch-NARRATIVE
  // knowledge base — problema/solucao/prova_tecnica/traccao_gtm/equipa/
  // mercado_timing/funding/ask. Different domain, and it holds no market
  // number at all. The numbers the founder states live here:
  // market_size_value_eur, market_size_scope, market_size_year,
  // market_size_source, growth_pct (migration 0241) and approach_note
  // (migration 0249 — NOT 0241, which is where an earlier draft of this
  // note placed it). They are edited in the "Added by you" panel
  // (AddedByYouPanel, MarketDataPanel.tsx) and written by this handler.
  //
  // So Bloco 5 compares org_market_data (claim) against market_facts
  // (evidence) — literally North Star §3.3's own example, "founder says
  // €200M+, verified €204.7M -> CONFIRMED".
  //
  // TWO THINGS MEASURED WHILE WRITING THIS, both of which the engine's
  // author needs and neither of which was obvious:
  //
  // 1. The MarketSizeCard (Prompt 487) does NOT read this table, contrary
  //    to what an earlier draft of this note claimed. It fetches
  //    /api/market-data/facts only, and that route never touches
  //    org_market_data. Today the founder's claim and the typed evidence
  //    are rendered by two components that share no data path — which is
  //    precisely the gap Bloco 5 closes, and worth knowing before assuming
  //    half of it already exists.
  //
  // 2. THIS TABLE IS ALREADY PARTLY INVESTOR-FACING. dossier-fetch.ts reads
  //    approach_note into the published dossier when the `rings` group is
  //    visible. That is legitimate (content DECLARED by the founder — see
  //    migration 0249's header), but it makes a trap concrete: a Bloco 5
  //    verdict is the opposite kind of thing. "CHALLENGED — the founder's
  //    number is not supported by the evidence" is performance DERIVED by
  //    the platform about the founder, which CLAUDE.md's privacy root rule
  //    forbids from every investor-facing surface outright, with no toggle.
  //    A verdict must never travel alongside the field it judges.
  const body = await req.json().catch(() => ({})) as {
    market_size_value_eur?: number | null; market_size_scope?: string | null; market_size_year?: number | null;
    market_size_source?: string | null; growth_pct?: number | null;
    segments?: string[]; free_sources?: { label: string; url: string }[];
    approach_note?: string | null;
  };

  // Prompt 384 §B.4/§E.2 — approach_note validated server-side too, never
  // only in the UI's maxLength (same discipline as every other gate in this
  // route). Prompt 384 §E.2 — `competitors` is deliberately absent from this
  // upsert: the editor that used to write it is gone from "Added by you"
  // (CompetitorsCard's structured flow is the only way in now), and leaving
  // the key out of this payload — rather than sending `[]` — means an
  // existing row's `competitors` column is simply never touched by the SET
  // clause a Supabase upsert generates, so old data stays exactly as it was
  // (nothing to migrate away from silently on the next save).
  if (body.approach_note != null && body.approach_note.length > 600) {
    return NextResponse.json({ ok: false, error: 'Keep "How we\'ll take it" under 600 characters.' }, { status: 400 });
  }

  const { error } = await admin.from('org_market_data').upsert({
    org_id: orgId,
    market_size_value_eur: body.market_size_value_eur ?? null,
    market_size_scope: body.market_size_scope ?? null,
    market_size_year: body.market_size_year ?? null,
    market_size_source: body.market_size_source ?? null,
    growth_pct: body.growth_pct ?? null,
    segments: body.segments ?? [],
    free_sources: body.free_sources ?? [],
    approach_note: body.approach_note?.trim() || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'org_id' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
