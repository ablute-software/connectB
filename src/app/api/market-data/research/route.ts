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

type Section = 'definition' | 'sizing' | 'growth' | 'players' | 'rounds' | 'trends' | 'regulatory';
const SECTIONS: Section[] = ['definition', 'sizing', 'growth', 'players', 'rounds', 'trends', 'regulatory'];

interface RawItem {
  section?: string; title?: string; detail?: string; source_url?: string; confidence?: string;
}

async function callResearchModel(apiKey: string, model: string, orgId: string, sectors: string[], country: string | null, stage: string | null) {
  const system = 'You are a research assistant for an early-stage startup founder preparing to raise capital. You search the '
    + 'public web and propose market-research items with a real, working source URL for each one — you never fabricate a '
    + 'number, a competitor, or a source, and you never rely on prior/training knowledge without verifying it via a fresh '
    + 'web search. Every item needs: section (one of definition, sizing, growth, players, rounds, trends, regulatory), a '
    + 'short title, a one-2-sentence detail, the source URL you found it on, and a confidence (high/medium/low). A market '
    + 'size estimate should state its range and basis plainly in the detail text (e.g. "€2-4B TAM, varies by report '
    + 'methodology") rather than pretending false precision. You finish every research task by calling propose_market_items, '
    + 'even if you found nothing for a section (simply omit that section\'s items). ' + DOCUMENT_CONTENT_INSTRUCTION;
  const prompt = `Sector(s): ${sectors.join(', ')}. ${country ? `Geography: ${country}.` : ''} ${stage ? `Stage: ${stage}.` : ''}\n\n`
    + 'Research this sector: definition/scope, market size estimates (with ranges and sources), growth rate, key '
    + 'competitors/players, comparable recent funding rounds (same sector/stage/geography — what an investor asks about), '
    + 'trends/drivers, and any relevant regulatory notes. Propose items via propose_market_items.';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 4000, system,
      messages: [{ role: 'user', content: prompt }],
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 8 },
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
                    section: { type: 'string', enum: SECTIONS },
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
  void logAiCall({ route: '/api/market-data/research', purpose: 'market_research', model, usage: data.usage, orgId });
  const toolUse = (data.content as { type: string; name?: string; input?: unknown }[])
    .filter((b) => b.type === 'tool_use' && b.name === 'propose_market_items').pop();
  const items = (toolUse?.input as { items?: RawItem[] } | undefined)?.items ?? [];
  return { items, costEur: computeCostEur(model, data.usage) };
}

async function resolveOrg(sb: Awaited<ReturnType<typeof serverClient>>, userId: string) {
  const { data } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

async function runResearchPass(admin: SupabaseClient, apiKey: string, orgId: string, sectors: string[], country: string | null, stage: string | null) {
  const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
  const signature = createHash('sha256').update(`${sectors.slice().sort().join(',')}|${country ?? ''}`).digest('hex');

  const { items, costEur } = await callResearchModel(apiKey, model, orgId, sectors, country, stage);
  void costEur;

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
  return signature;
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

  const signature = createHash('sha256').update(`${sectors.slice().sort().join(',')}|${orgRow.country ?? ''}`).digest('hex');
  const forceRefresh = new URL(req.url).searchParams.get('force') === '1';

  const { data: existing } = await admin.from('market_research_items')
    .select('run_signature').eq('org_id', orgId).limit(1);
  const cached = (existing ?? []).some((r) => r.run_signature === signature);

  if (apiKey && (forceRefresh || !cached)) {
    try {
      await runResearchPass(admin, apiKey, orgId, sectors, orgRow.country, orgRow.stage);
    } catch (e) {
      console.error('[market-data/research] AI pass failed', (e as Error).message);
    }
  }

  const { data: items } = await admin.from('market_research_items')
    .select('id, section, title, detail, source_url, confidence, status, source_accessed_at')
    .eq('org_id', orgId).eq('status', 'pending').order('section', { ascending: true });

  return NextResponse.json({ available: true, items: items ?? [], gate });
}
