// Prompt 360 §A1.3 — "Sherlock research": the same web-search + proposals-
// with-source-and-confidence mechanic entities/[id]/enrich already uses
// (web_search_20250305 tool, tool_choice 'auto' so the model can search
// first and propose second), never a new web-search integration. Every
// proposal MUST carry a source_url — the tool schema makes it required,
// and any item the model returns without one is dropped before it's even
// stored, never surfaced as if a citation existed.
//
// Prompt 445 — a research run is always scoped to ONE market hypothesis
// (444 §B), never the whole org. This replaces the confirmed bug where the
// query was built from sectors.join(', ') and proposed Cleanwatts/Agroop/
// Gazelle Wind Power/SoundSafe as "competitors" for a health biochip — the
// query now reasons from the founder's own Market Thesis + the specific
// hypothesis being researched, and sectors/stage/country enter only as
// secondary context, never the primary axis. Cached by
// (hypothesisId, thesisVersion, section) — editing the thesis invalidates
// every hypothesis's cache even with the same hypothesisId, since a
// changed thesis can invalidate what was previously "known". §C/§D:
// sizing/growth/rounds/players now require a validated `structured` field
// (market-research-structured.ts) — an item without one for those four
// sections is discarded before it is ever written — and every row's
// fact_status is computed at write time from structured + source presence
// + cross-source agreement within the same run, never derived later from
// free text.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { resolveUserPlan } from '@/lib/plan-server';
import { planEntitlements } from '@/lib/plans';
import { assertNotViewer } from '@/lib/developer-viewer';
import { marketResearchItemsAvailable, marketThesisAvailable, marketHypothesesAvailable } from '@/lib/market-data-capability';
import { checkMarketDataGate } from '@/lib/market-data-gate';
import { logAiCall, computeCostEur } from '@/lib/ai-cost-log';
import { DOCUMENT_CONTENT_INSTRUCTION } from '@/lib/prompt-injection-defense';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import type { MarketThesisFields } from '@/lib/market-thesis';
import {
  parseStructuredForSection, computeFactStatusForRun, signatureFor, STRUCTURED_REQUIRED_SECTIONS, type StructuredForSection,
} from '@/lib/market-research-structured';
import { computeVerdict, type FounderBaseline } from '@/lib/market-assessment-engine';

import { SECTIONS, type Section } from '@/lib/market-research-sections';

// Prompt 378 §0 — THE production bug. This was the only AI route in the app
// doing a web search without a maxDuration export: its siblings all have one
// (team-sherlock-research 60, market-data/document-extract 60, gap-assist
// 30). Without it Vercel applies the ~10s default and kills the function
// mid-search — a web-search pass takes 30-120s — so on the real site this
// feature could never once have completed, while locally (no limit) it
// worked fine, which is exactly why it passed verification and still shipped
// broken. Never add an AI/web-search route here without this export.
export const maxDuration = 60;

// Prompt 373 §D — "a button per section": each section's own targeted
// instruction, so scoping to one section actually narrows what the model
// looks for instead of just filtering a full-sweep result down to it —
// narrower search, fewer tokens, a real (not cosmetic) per-section cost.
//
// Prompt 445 §C — players rewritten: THE fix for the Cleanwatts/Agroop bug.
// A shared sector label is explicitly disqualified as a reason to call
// something a competitor; the model must classify from the buyer/problem/
// use-case match instead, one of the 6 types the structured field also
// enforces (parseStructuredForSection discards anything that doesn't fit).
const SECTION_INSTRUCTION: Record<Section, string> = {
  definition: 'the definition and scope of this market/category — what it includes and excludes.',
  sizing: 'market size estimates (TAM/SAM/SOM-style figures), each with its range, year, geography and basis plainly stated — never a bare number.',
  growth: 'the growth rate of this market, with the period and source it comes from.',
  // Prompt 450 — replaces the free-choice competitorType label: the model
  // no longer classifies anything, it only scores the RELATIONSHIP against
  // 5 facets with sourced evidence — classifyCompetitor (market-
  // competition.ts) is the only thing that turns that into a classification.
  players: 'the key competitors. For EACH candidate, do not just name it — score the RELATIONSHIP against 5 facets: does it '
    + 'solve the same problem/job-to-be-done, deliver a substitutable outcome, for the same buyer/user, in the same use context? '
    + 'Every MATCH or PARTIAL needs a source URL for THAT specific claim, ideally the candidate\'s own site/product page — not '
    + 'just wherever you first found the name (a directory or "top N startups" listicle is fine for finding a name, never for '
    + 'proving a relationship). A shared sector label alone is NOT evidence of any facet. If you cannot find evidence for a '
    + 'facet, say UNKNOWN honestly — do not guess, and do not mark it NO_MATCH just because you found nothing. If the true '
    + 'comparison is not another company but the buyer\'s current non-product alternative (a spreadsheet, a manual process, '
    + 'doing nothing), say so directly instead of forcing a relationship score. If the candidate is still research-stage or '
    + 'pre-commercial, say so — it changes the classification.',
  // Prompt 384 §F — these two were the only sections timing out (Vercel's
  // 504 at maxDuration=60, confirmed via real runtime logs: a 42.8s success
  // and an actual 60-80s/504 failure on the exact same open, multi-entity
  // search). Narrowing the ask (a bounded count, explicit filters) shortens
  // the search itself instead of just capping tool calls around the same
  // open-ended brief.
  rounds: 'the 3-5 most comparable recent funding rounds — same sector, same stage, Europe-first, last 24 months, one round per '
    + 'company, only with a verifiable source. Skip anything older or unsourced rather than searching further for it. This is '
    + 'the benchmark an investor will ask the founder to justify — a short, well-sourced list beats an exhaustive one.',
  trends: 'the 3-4 most important demand/market drivers shaping this market right now, each with a concrete number attached '
    + '(growth rate, adoption figure, spend figure, regulatory deadline, etc.) — never a vague trend with no figure behind it.',
  regulatory: 'any relevant regulatory notes or requirements for this market.',
};

// Prompt 384 §F — narrower budget for the two sections above only; the other
// five stay at the original section?4:8 split (confirmed fine in production).
const NARROW_SEARCH_BUDGET: Partial<Record<Section, number>> = { rounds: 3, trends: 3 };

interface RawItem {
  section?: string; title?: string; detail?: string; source_url?: string; confidence?: string; structured?: unknown;
}

// Prompt 445 §C — a single flat schema covering every section's fields,
// all optional at the JSON-schema level (Anthropic tool calling doesn't
// reliably enforce a schema conditional on a sibling field's value) — the
// REAL per-section requiredness is enforced afterward, server-side, by
// parseStructuredForSection. Trends/regulatory/definition simply never
// populate this and are never required to.
// Prompt 450 — players' facet-scoring shape, shared by the 5 decisive
// facets and the 5 optional/auxiliary ones: state is what the candidate
// actually scores, note is free-text context, sourceUrl is required by
// parseStructuredForSection (market-research-structured.ts) whenever state
// is MATCH or PARTIAL — a facet that comes back without one regresses to
// UNKNOWN there rather than being trusted uncited.
const FACET_SCHEMA = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['MATCH', 'PARTIAL', 'NO_MATCH', 'UNKNOWN'] },
    note: { type: 'string' },
    sourceUrl: { type: 'string', description: 'required when state is MATCH or PARTIAL' },
  },
};

const STRUCTURED_SCHEMA = {
  type: 'object',
  description: 'Structured fields for this item — which ones apply depends on section. sizing needs valueEur/scope/year/geography/method. '
    + 'growth needs pct/periodYears (segment optional). rounds needs company/amountEur/date/stage. players needs company, then EITHER '
    + 'statusQuoNote (buyer\'s current non-product behavior) OR candidateStage + relation (a real candidate, scored). '
    + 'Omit fields that do not apply to this item\'s section.',
  properties: {
    valueEur: { type: 'number', description: 'sizing: the market value in EUR' },
    scope: { type: 'string', enum: ['TAM', 'SAM', 'SOM'], description: 'sizing only' },
    year: { type: 'number', description: 'sizing only' },
    geography: { type: 'string', description: 'sizing only — the geography this figure covers' },
    method: { type: 'string', enum: ['top_down', 'bottom_up', 'analyst_report', 'secondary_citation'], description: 'sizing only — how this figure was derived' },
    pct: { type: 'number', description: 'growth: the growth rate as a percentage' },
    periodYears: { type: 'number', description: 'growth only' },
    segment: { type: 'string', description: 'growth only, optional' },
    company: { type: 'string', description: 'rounds/players: the company name' },
    amountEur: { type: 'number', description: 'rounds only: the round amount in EUR' },
    date: { type: 'string', description: 'rounds only' },
    stage: { type: 'string', description: 'rounds only: the round stage (e.g. Series A)' },
    candidateStage: { type: 'string', enum: ['commercial', 'pre_commercial', 'unknown'], description: 'players only' },
    statusQuoNote: { type: 'string', description: 'players only — fill this INSTEAD of relation when the true comparison is the buyer\'s current non-product behavior' },
    relation: {
      type: 'object',
      description: 'players only — omit if statusQuoNote is used. problemOrJobOverlap/outcomeOverlap/substitutability/'
        + 'userOrBuyerOverlap/useContextOverlap are required; budgetOverlap/technologyOverlap/inputOverlap/geographyOverlap/'
        + 'channelOverlap are optional context',
      properties: {
        problemOrJobOverlap: FACET_SCHEMA, outcomeOverlap: FACET_SCHEMA, substitutability: FACET_SCHEMA,
        userOrBuyerOverlap: FACET_SCHEMA, useContextOverlap: FACET_SCHEMA,
        budgetOverlap: FACET_SCHEMA, technologyOverlap: FACET_SCHEMA, inputOverlap: FACET_SCHEMA,
        geographyOverlap: FACET_SCHEMA, channelOverlap: FACET_SCHEMA,
      },
    },
  },
};

async function callResearchModel(
  apiKey: string, model: string, orgId: string,
  hypothesis: { label: string; definition: string }, thesis: MarketThesisFields,
  country: string | null, stage: string | null, section: Section | null,
) {
  const sections = section ? [section] : SECTIONS;
  const system = 'You are a research assistant for an early-stage startup founder preparing to raise capital. You search the '
    + 'public web and propose market-research items with a real, working source URL for each one — you never fabricate a '
    + `number, a competitor, or a source, and you never rely on prior/training knowledge without verifying it via a fresh `
    + `web search. Every item needs: section (${sections.length === 1 ? `always "${sections[0]}"` : `one of ${sections.join(', ')}`}), a `
    + 'short title, a one-2-sentence detail, the source URL you found it on, a confidence (high/medium/low), and — for sizing/'
    + 'growth/rounds/players — the matching structured fields (see the tool schema); an item in one of those four sections '
    + 'with no valid structured data will be discarded, so fill it in whenever you have the figures. A market size estimate '
    + 'should state its range and basis plainly in the detail text (e.g. "€2-4B TAM, varies by report methodology") rather '
    + 'than pretending false precision. Analyst reports (Gartner/IDC/Frost etc.) are usually behind a paywall — if you can '
    + 'only see a SECOND-HAND citation of one (never the report itself), say so plainly in the detail and note it is a '
    + 'secondary source. A self-computed estimate (e.g. bottom-up from a unit count × price) is legitimate ONLY if you show '
    + 'the actual arithmetic in the detail text — never a number with no visible method. '
    // Prompt 445 §B — the founder's own hard filter, not a suggestion.
    + 'The founder has explicitly told you what this market is NOT — when a market/category is named as excluded, never '
    + 'propose anything from it, even if it looks adjacent or plausible; treat it as a hard filter, not a soft preference. '
    + 'You finish every research task by calling propose_market_items, even if you found nothing (simply omit items). ' + DOCUMENT_CONTENT_INSTRUCTION;

  // Prompt 445 §B — the exact template: hypothesis + thesis first, as the
  // PRIMARY axis; org-level stage/country only ever as secondary context
  // appended after it, never the leading signal.
  const thesisBlock = [
    `Market hypothesis: "${hypothesis.label}" — ${hypothesis.definition}`,
    `What the company does: ${thesis.product_summary ?? 'not specified'}`,
    `Core problem: ${thesis.core_problem ?? 'not specified'}`,
    `Primary user: ${thesis.primary_user ?? 'not specified'}`,
    `Economic buyer: ${thesis.economic_buyer ?? 'not specified'}`,
    `Geography: ${thesis.geography ?? 'not specified — do not assume'}`,
    `Explicitly NOT this market: ${thesis.excluded_markets.join(', ') || 'none stated'}`,
  ].join('\n');
  const secondaryContext = [country && `org country: ${country}`, stage && `stage: ${stage}`].filter(Boolean).join(', ');
  const prompt = `${thesisBlock}${secondaryContext ? `\nAdditional context — ${secondaryContext}.` : ''}\n\n`
    + `Research ${sections.map((s) => SECTION_INSTRUCTION[s]).join(' Also research ')} Propose items via propose_market_items.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 4000, system,
      messages: [{ role: 'user', content: prompt }],
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: section ? (NARROW_SEARCH_BUDGET[section] ?? 4) : 8 },
        {
          name: 'propose_market_items',
          description: 'Return the researched market items, each with a real source URL.',
          input_schema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    section: { type: 'string', enum: sections },
                    title: { type: 'string' },
                    detail: { type: 'string' },
                    source_url: { type: 'string' },
                    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                    structured: STRUCTURED_SCHEMA,
                  },
                  required: ['section', 'title', 'detail', 'source_url', 'confidence'],
                },
              },
            },
            required: ['items'],
          },
        },
      ],
      tool_choice: { type: 'auto' },
    }),
  });
  if (!res.ok) throw new Error(providerErrorMessage('[market-data/research]', await res.text()));
  const data = await res.json();
  // Prompt 373 §D — a distinct purpose per section (market_research_sizing,
  // market_research_players, ...) so /api/market-data/research/estimate can
  // show a real per-section cost history, and so ai_call_log's per-founder
  // accounting stays as granular as the buttons the founder actually clicks.
  // Unchanged by 445 — cost varies by section/search volume, never by which
  // hypothesis is being researched (§F).
  void logAiCall({ route: '/api/market-data/research', purpose: section ? `market_research_${section}` : 'market_research', model, usage: data.usage, orgId });
  const toolUse = (data.content as { type: string; name?: string; input?: unknown }[])
    .filter((b) => b.type === 'tool_use' && b.name === 'propose_market_items').pop();
  const items = (toolUse?.input as { items?: RawItem[] } | undefined)?.items ?? [];
  return { items, costEur: computeCostEur(model, data.usage) };
}

async function resolveOrg(sb: Awaited<ReturnType<typeof serverClient>>, userId: string) {
  const { data } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

async function runResearchPass(
  admin: SupabaseClient, apiKey: string, orgId: string,
  hypothesis: { id: string; label: string; definition: string }, thesis: MarketThesisFields,
  thesisVersion: number, country: string | null, stage: string | null, section: Section | null,
) {
  const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
  const signature = signatureFor(hypothesis.id, thesisVersion, section);

  const { items, costEur } = await callResearchModel(apiKey, model, orgId, hypothesis, thesis, country, stage, section);

  // Prompt 445 §C/§D — validate + discard BEFORE any write, then compute
  // fact_status once per (section, title) group across the whole run —
  // never a per-item guess and never a later pass over already-written rows.
  const prepared: { title: string; detail: string; sourceUrl: string; section: Section; confidence: 'high' | 'medium' | 'low' | null; structured: StructuredForSection | null }[] = [];
  for (const item of items) {
    const title = item.title?.trim();
    const detail = item.detail?.trim();
    const sourceUrl = item.source_url?.trim();
    const itemSection = SECTIONS.includes(item.section as Section) ? (item.section as Section) : null;
    // Every item MUST carry a real source — no exceptions, per this
    // feature's own root rule ("Nada sem fonte").
    if (!title || !detail || !sourceUrl || !itemSection) continue;
    const confidence = item.confidence === 'high' || item.confidence === 'medium' || item.confidence === 'low' ? item.confidence : null;
    const structured = parseStructuredForSection(itemSection, item.structured);
    // §C — sizing/growth/rounds/players without valid structured never
    // reach upsert; the other three sections have no typed structured this
    // phase (§H), so structured stays null for them by construction.
    if (STRUCTURED_REQUIRED_SECTIONS.includes(itemSection) && !structured) continue;
    prepared.push({ title, detail, sourceUrl, section: itemSection, confidence, structured });
  }

  const factStatusByIndex = computeFactStatusForRun(
    prepared.map((p) => ({ section: p.section, title: p.title, sourceUrl: p.sourceUrl, structured: p.structured })),
  );

  // Prompt 446 §C — fetched ONCE per run, not per item.
  // Known limitation, documented as such (same style as 445's own
  // constraint note): org_market_data is ONE row per org, not per
  // hypothesis — the founder has only one globally-declared "market size"
  // and "growth", not one per hypothesis. With 3 active hypotheses, all
  // three compare against the SAME declared number. Accepted for this
  // phase; stretching org_market_data to be per-hypothesis is a bigger
  // schema decision, out of this prompt's scope.
  const [{ data: orgMarketDataRow }, { data: competitorRows }] = await Promise.all([
    admin.from('org_market_data').select('market_size_value_eur, growth_pct').eq('org_id', orgId).maybeSingle(),
    admin.from('org_competitors').select('market_companies(name)').eq('org_id', orgId),
  ]);
  const founderBaseline: FounderBaseline = {
    sizingValueEur: (orgMarketDataRow?.market_size_value_eur as number | null) ?? null,
    growthPct: (orgMarketDataRow?.growth_pct as number | null) ?? null,
    knownCompetitorNames: ((competitorRows ?? []) as { market_companies: { name?: string } | null }[])
      .map((r) => r.market_companies?.name?.trim().toLowerCase())
      .filter((n): n is string => !!n),
  };

  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    const factStatus = factStatusByIndex.get(i) ?? null;
    // §C — computeVerdict runs alongside computeFactStatusForRun and is
    // written into the SAME upsert below — never a second update pass.
    const verdict = factStatus ? computeVerdict(p.section, factStatus, p.structured, founderBaseline) : null;
    // Known limitation, stated plainly: the unique constraint backing this
    // upsert is still (org_id, section, title) — unchanged by migration
    // 0273, which only added hypothesis_id/fact_status as columns, not a
    // new uniqueness axis. Two DIFFERENT hypotheses proposing the exact
    // same title in the same section would collide here (the second is
    // silently ignored, same ignoreDuplicates behavior this upsert already
    // had). Titles are hypothesis-specific enough in practice that this is
    // a narrow edge case, and widening the constraint is a schema decision
    // 445 wasn't asked to make — flagged, not silently worked around.
    await admin.from('market_research_items').upsert({
      org_id: orgId, hypothesis_id: hypothesis.id, run_signature: signature, section: p.section, title: p.title, detail: p.detail,
      source_url: p.sourceUrl, source_accessed_at: new Date().toISOString(), confidence: p.confidence,
      structured: p.structured, fact_status: factStatus,
      change_class: verdict?.changeClass ?? null, delta_type: verdict?.deltaType ?? null,
      comparison_baseline: verdict?.comparisonBaseline ?? null,
      implication_code: verdict?.implication?.code ?? null, implication_scope: verdict?.implication?.scope ?? null,
      implication_direction: verdict?.implication?.direction ?? null,
      insight_confidence: verdict?.insightConfidence ?? null, promoted_to_insight: verdict?.promotedToInsight ?? false,
      status: 'pending', updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,section,title', ignoreDuplicates: true });
  }
  return { signature, costEur };
}

function toThesisFields(row: Record<string, unknown> | null): MarketThesisFields {
  return {
    product_summary: (row?.product_summary as string | null) ?? null,
    core_problem: (row?.core_problem as string | null) ?? null,
    primary_user: (row?.primary_user as string | null) ?? null,
    economic_buyer: (row?.economic_buyer as string | null) ?? null,
    beachhead: (row?.beachhead as string | null) ?? null,
    geography: (row?.geography as string | null) ?? null,
    primary_use_case: (row?.primary_use_case as string | null) ?? null,
    adjacent_technologies: (row?.adjacent_technologies as string[] | null) ?? [],
    excluded_markets: (row?.excluded_markets as string[] | null) ?? [],
  };
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const empty = { available: false, items: [] };
  if (!url || !serviceKey) return NextResponse.json(empty);

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await marketResearchItemsAvailable()) || !(await marketThesisAvailable()) || !(await marketHypothesesAvailable())) {
    return NextResponse.json(empty);
  }

  const orgId = await resolveOrg(sb, user.id);
  if (!orgId) return NextResponse.json(empty);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Same motherfunding-only paywall the rest of the top-tier review tools
  // already enforce (ai-review/route.ts's own precedent), checked here too
  // — never only in the UI.
  const [role, { plan }] = await Promise.all([
    resolveRole(user.id, user.email, sb, user.email_confirmed_at),
    resolveUserPlan(user.id, sb),
  ]);
  if (!planEntitlements(plan, role === 'developer').reviewTopTierTools) {
    return NextResponse.json({ error: 'This tool is available on a higher plan.' }, { status: 403 });
  }

  const [{ data: org }, { data: claims }] = await Promise.all([
    admin.from('orgs').select('sectors, sectors_other, stage, one_liner, country').eq('id', orgId).maybeSingle(),
    admin.from('company_claims').select('category').eq('org_id', orgId).eq('status', 'accepted'),
  ]);
  const orgRow = (org ?? {}) as { sectors: string[] | null; sectors_other: string | null; stage: string | null; one_liner: string | null; country: string | null };
  const sectors = [...(orgRow.sectors ?? []), orgRow.sectors_other?.trim()].filter(Boolean) as string[];
  const hasMarketOrSolutionClaim = ((claims ?? []) as { category: string }[]).some((c) => c.category === 'mercado_timing' || c.category === 'solucao');
  const gate = checkMarketDataGate({ sectors, stage: orgRow.stage, oneLiner: orgRow.one_liner }, true, hasMarketOrSolutionClaim);
  if (!gate.eligible) return NextResponse.json({ available: true, items: [], gate });

  // Prompt 445 §A — replaces the old sectors.length===0 early-return: the
  // real gate for a per-hypothesis feature is having a hypothesis to
  // target, not sector tags. Never runs research without one.
  const { data: activeHypotheses } = await admin.from('org_market_hypotheses')
    .select('id, label, definition').eq('org_id', orgId).eq('status', 'active');
  if (!activeHypotheses || activeHypotheses.length === 0) {
    return NextResponse.json({ available: true, items: [], gate: { eligible: false, reason: 'no_hypotheses' } });
  }

  const hypothesisIdParam = new URL(req.url).searchParams.get('hypothesisId');
  const hypothesis = activeHypotheses.find((h) => h.id === hypothesisIdParam);
  if (!hypothesis) return NextResponse.json({ ok: false, error: 'A valid hypothesisId is required.' }, { status: 400 });

  const { data: thesisRow } = await admin.from('org_market_thesis').select('*').eq('org_id', orgId).maybeSingle();
  const thesisFields = toThesisFields(thesisRow);
  const thesisVersion = (thesisRow?.version as number | undefined) ?? 1;

  // Prompt 373 §D — a button per section: ?section=X scopes the whole pass
  // (cache signature included) to just that one section. Omitting it keeps
  // the original full-sweep behavior for any caller that predates this.
  const sectionParam = new URL(req.url).searchParams.get('section');
  const section: Section | null = sectionParam && (SECTIONS as string[]).includes(sectionParam) ? (sectionParam as Section) : null;
  const signature = signatureFor(hypothesis.id, thesisVersion, section);
  const forceRefresh = new URL(req.url).searchParams.get('force') === '1';

  const { data: existing } = await admin.from('market_research_items')
    .select('run_signature').eq('org_id', orgId).eq('hypothesis_id', hypothesis.id).limit(1);
  const cached = (existing ?? []).some((r) => r.run_signature === signature);

  // Prompt 378 §A.1 — a failure is REPORTED, never swallowed into a 200 with
  // an empty list. The old shape (catch -> console.error -> 200 items:[])
  // is precisely why the founder's clicks looked like "the button does
  // nothing": the one party who could act on the error was the only one
  // never told. Same class of bug as 371's silent "r" and 375's 401->pending.
  let costEur: number | null = null;
  let ran = false;
  if (!apiKey) {
    return NextResponse.json({
      available: true, items: [], gate, costEur: null, ran: false,
      ok: false, aiError: 'AI isn\'t configured in this workspace yet.',
    });
  }
  if (forceRefresh || !cached) {
    try {
      const result = await runResearchPass(admin, apiKey, orgId, hypothesis, thesisFields, thesisVersion, orgRow.country, orgRow.stage, section);
      costEur = result.costEur;
      ran = true;
    } catch (e) {
      // providerErrorMessage already sanitized this inside callResearchModel
      // (never a raw provider body to the client — Prompt 307 §A).
      return NextResponse.json({ available: true, items: [], gate, costEur: null, ran: false, ok: false, aiError: (e as Error).message });
    }
  }

  // Prompt 445 §A — reads always filter by hypothesis_id now, never org
  // alone; pre-445 rows (hypothesis_id null) simply never surface here.
  let query = admin.from('market_research_items')
    .select('id, section, title, detail, source_url, confidence, status, source_accessed_at, structured, fact_status')
    .eq('org_id', orgId).eq('hypothesis_id', hypothesis.id).eq('status', 'pending');
  if (section) query = query.eq('section', section);
  const { data: items } = await query.order('section', { ascending: true });

  // `ran` distinguishes §A.2 ("we really searched and found nothing with a
  // verifiable source") from a cache hit — the UI must never show the
  // generic "no pending suggestions" for a real, paid-for empty result.
  return NextResponse.json({ available: true, ok: true, items: items ?? [], gate, costEur, ran, cached: cached && !forceRefresh, hypothesisId: hypothesis.id });
}
