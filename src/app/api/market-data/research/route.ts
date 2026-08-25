// Prompt 360 §A1.3 — "Sherlock research": the same web-search + proposals-
// with-source-and-confidence mechanic entities/[id]/enrich already uses
// (web_search_20250305 tool, tool_choice 'auto' so the model can search
// first and propose second), never a new web-search integration. Cached by
// (sectors, geography) — a plain GET on an unchanged signature costs
// nothing; `?force=1` (the founder's own "Refresh" click) always re-runs and
// re-pays. Every proposal MUST carry a source_url — the tool schema makes it
// required, and any item the model returns without one is dropped before
// it's even stored, never surfaced as if a citation existed.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { resolveUserPlan } from '@/lib/plan-server';
import { planEntitlements } from '@/lib/plans';
import { assertNotViewer } from '@/lib/developer-viewer';
import { marketResearchItemsAvailable } from '@/lib/market-data-capability';
import { checkMarketDataGate } from '@/lib/market-data-gate';
import { logAiCall, computeCostEur } from '@/lib/ai-cost-log';
import { DOCUMENT_CONTENT_INSTRUCTION } from '@/lib/prompt-injection-defense';
import { providerErrorMessage } from '@/lib/ai-provider-error';

import { SECTIONS, type Section } from '@/lib/market-research-sections';

// Prompt 373 §D — "a button per section": each section's own targeted
// instruction, so scoping to one section actually narrows what the model
// looks for instead of just filtering a full-sweep result down to it —
// narrower search, fewer tokens, a real (not cosmetic) per-section cost.
const SECTION_INSTRUCTION: Record<Section, string> = {
  definition: 'the definition and scope of this market/category — what it includes and excludes.',
  sizing: 'market size estimates (TAM/SAM/SOM-style figures), each with its range, year, geography and basis plainly stated — never a bare number.',
  growth: 'the growth rate of this market, with the period and source it comes from.',
  players: 'the key competitors/players in this space — real companies, not categories.',
  rounds: 'comparable recent funding rounds in the same sector/stage/geography — what an investor will ask you to benchmark against.',
  trends: 'the trends and drivers shaping this market right now.',
  regulatory: 'any relevant regulatory notes or requirements for this market.',
};

interface RawItem {
  section?: string; title?: string; detail?: string; source_url?: string; confidence?: string;
}

async function callResearchModel(
  apiKey: string, model: string, orgId: string, sectors: string[], country: string | null, stage: string | null, section: Section | null,
) {
  const sections = section ? [section] : SECTIONS;
  const system = 'You are a research assistant for an early-stage startup founder preparing to raise capital. You search the '
    + 'public web and propose market-research items with a real, working source URL for each one — you never fabricate a '
    + `number, a competitor, or a source, and you never rely on prior/training knowledge without verifying it via a fresh `
    + `web search. Every item needs: section (${sections.length === 1 ? `always "${sections[0]}"` : `one of ${sections.join(', ')}`}), a `
    + 'short title, a one-2-sentence detail, the source URL you found it on, and a confidence (high/medium/low). A market '
    + 'size estimate should state its range and basis plainly in the detail text (e.g. "€2-4B TAM, varies by report '
    + 'methodology") rather than pretending false precision. Analyst reports (Gartner/IDC/Frost etc.) are usually behind a '
    + 'paywall — if you can only see a SECOND-HAND citation of one (never the report itself), say so plainly in the detail '
    + 'and note it is a secondary source. A self-computed estimate (e.g. bottom-up from a unit count × price) is legitimate '
    + 'ONLY if you show the actual arithmetic in the detail text — never a number with no visible method. You finish every '
    + 'research task by calling propose_market_items, even if you found nothing (simply omit items). ' + DOCUMENT_CONTENT_INSTRUCTION;
  const prompt = `Sector(s): ${sectors.join(', ')}. ${country ? `Geography: ${country}.` : ''} ${stage ? `Stage: ${stage}.` : ''}\n\n`
    + `Research ${sections.map((s) => SECTION_INSTRUCTION[s]).join(' Also research ')} Propose items via propose_market_items.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 4000, system,
      messages: [{ role: 'user', content: prompt }],
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: section ? 4 : 8 },
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

function signatureFor(sectors: string[], country: string | null, section: Section | null): string {
  return createHash('sha256').update(`${sectors.slice().sort().join(',')}|${country ?? ''}|${section ?? 'all'}`).digest('hex');
}

async function runResearchPass(
  admin: SupabaseClient, apiKey: string, orgId: string, sectors: string[], country: string | null, stage: string | null, section: Section | null,
) {
  const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
  const signature = signatureFor(sectors, country, section);

  const { items, costEur } = await callResearchModel(apiKey, model, orgId, sectors, country, stage, section);

  for (const item of items) {
    const title = item.title?.trim();
    const detail = item.detail?.trim();
    const sourceUrl = item.source_url?.trim();
    const section = SECTIONS.includes(item.section as Section) ? (item.section as Section) : null;
    // Every item MUST carry a real source — no exceptions, per this
    // feature's own root rule ("Nada sem fonte").
    if (!title || !detail || !sourceUrl || !section) continue;
    const confidence = item.confidence === 'high' || item.confidence === 'medium' || item.confidence === 'low' ? item.confidence : null;
    await admin.from('market_research_items').upsert({
      org_id: orgId, run_signature: signature, section, title, detail,
      source_url: sourceUrl, source_accessed_at: new Date().toISOString(), confidence,
      status: 'pending', updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,section,title', ignoreDuplicates: true });
  }
  return { signature, costEur };
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
  if (!(await marketResearchItemsAvailable())) return NextResponse.json(empty);

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
  if (!gate.eligible || sectors.length === 0) return NextResponse.json({ available: true, items: [], gate });

  // Prompt 373 §D — a button per section: ?section=X scopes the whole pass
  // (cache signature included) to just that one section. Omitting it keeps
  // the original full-sweep behavior for any caller that predates this.
  const sectionParam = new URL(req.url).searchParams.get('section');
  const section: Section | null = sectionParam && (SECTIONS as string[]).includes(sectionParam) ? (sectionParam as Section) : null;
  const signature = signatureFor(sectors, orgRow.country, section);
  const forceRefresh = new URL(req.url).searchParams.get('force') === '1';

  const { data: existing } = await admin.from('market_research_items')
    .select('run_signature').eq('org_id', orgId).limit(1);
  const cached = (existing ?? []).some((r) => r.run_signature === signature);

  let costEur: number | null = null;
  if (apiKey && (forceRefresh || !cached)) {
    try {
      const result = await runResearchPass(admin, apiKey, orgId, sectors, orgRow.country, orgRow.stage, section);
      costEur = result.costEur;
    } catch (e) {
      console.error('[market-data/research] AI pass failed', (e as Error).message);
    }
  }

  let query = admin.from('market_research_items')
    .select('id, section, title, detail, source_url, confidence, status, source_accessed_at')
    .eq('org_id', orgId).eq('status', 'pending');
  if (section) query = query.eq('section', section);
  const { data: items } = await query.order('section', { ascending: true });

  return NextResponse.json({ available: true, items: items ?? [], gate, costEur });
}
