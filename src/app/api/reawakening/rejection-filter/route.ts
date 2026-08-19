// Prompt 251/253 Bloco D — the second-pass AI filter over Bloco B's
// deterministic clash-clear detector (rejection-code-match.ts). Called
// ONLY from applyReactivations (store-supabase.tsx), and only when the
// calling org has opted in (orgs.reawakening_ai_filter_enabled). Never a
// second detector: this route trusts every case it receives as an ALREADY
// cleared rejection_code — it only judges whether/how the resulting
// suggestion should reach the founder (pass / enrich wording / hold with a
// reason), same split as /api/reawakening/evaluate (mechanical prefilter
// vs. AI judgment), applied to a different trigger.
//
// Fail-open by construction (§4 of the prompt): any missing config, auth
// gap, or AI-call failure returns verdicts=[] rather than an error — the
// caller treats an absent verdict as an implicit 'pass' (see
// applyFilterVerdicts), so proposals/tasks are created exactly as if this
// filter did not exist. This route never blocks the deterministic engine.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { reawakeningAiFilterAvailable } from '@/lib/reawakening-ai-filter-capability';
import { buildRejectionFilterPrompt, type FilterCase, type RawFilterVerdict } from '@/lib/reawakening-ai-filter';
import { chunk } from '@/lib/reawakening';

async function callFilter(apiKey: string, model: string, cases: FilterCase[]): Promise<RawFilterVerdict[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 2000,
      system: 'You are a second-pass judge for a startup CRM\'s automatic reopening detector. A deterministic rule already confirmed a '
        + 'specific investor rejection reason no longer applies given current data — you never re-decide that, you only judge whether '
        + 'resurfacing it to the founder right now is a good idea, and whether the suggested wording could be sharper. You never invent '
        + 'facts. Default to "pass" when genuinely unsure — holding back a real opportunity costs more than a slightly premature nudge.',
      messages: [{ role: 'user', content: buildRejectionFilterPrompt(cases) }],
      tools: [{
        name: 'filter_reactivations',
        description: 'Return one verdict per case.',
        input_schema: {
          type: 'object',
          properties: {
            verdicts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  rejection_code_id: { type: 'string' },
                  verdict: { type: 'string', enum: ['pass', 'enrich', 'hold'] },
                  ai_note: { type: 'string' },
                  enriched_rationale: { type: 'string' },
                  enriched_task_title: { type: 'string' },
                },
                required: ['rejection_code_id', 'verdict', 'ai_note'],
              },
            },
          },
          required: ['verdicts'],
        },
      }],
      tool_choice: { type: 'tool', name: 'filter_reactivations' },
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const input = data.content?.find((b: { type: string }) => b.type === 'tool_use')?.input as { verdicts?: RawFilterVerdict[] } | undefined;
  return input?.verdicts ?? [];
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true, verdicts: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { orgId?: string; cases?: FilterCase[] };
  if (!body.orgId || !Array.isArray(body.cases) || body.cases.length === 0) {
    return NextResponse.json({ ok: true, verdicts: [] });
  }

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', body.orgId).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  if (!(await reawakeningAiFilterAvailable())) return NextResponse.json({ ok: true, verdicts: [] });

  const admin: SupabaseClient = createClient(url, service, { auth: { persistSession: false } });

  // Ownership check — org membership (above) only proves the caller belongs
  // to body.orgId, not that the rejection_code_ids in body.cases actually
  // belong to THAT org. Without this, a member of org A could pass org B's
  // real rejection_code_id (founder-private reasoning about a different
  // startup) and either read back org B's cached verdict verbatim, or — on
  // a cache miss — get the AI to evaluate fabricated case text and upsert
  // the result under org B's real code id, permanently poisoning the one
  // verdict org B's own future evaluation of that code will ever receive
  // (the cache has no TTL). Every case whose id doesn't resolve to a
  // rejection_codes row owned by body.orgId is silently dropped, never
  // reaches the cache or the model.
  const { data: ownedCodes } = await admin.from('rejection_codes').select('id')
    .eq('org_id', body.orgId).in('id', body.cases.map((c) => c.rejectionCodeId));
  const ownedIds = new Set((ownedCodes ?? []).map((r) => r.id as string));
  const cases = body.cases.filter((c) => ownedIds.has(c.rejectionCodeId));
  if (cases.length === 0) return NextResponse.json({ ok: true, verdicts: [] });

  // Cache-first, per case — the same case re-firing (addOrgAxisClassification
  // has no entity filter, so one write can re-evaluate several codes across
  // several triggers before any of them has a real proposal) never pays for
  // a second AI call.
  const { data: cachedRows } = await admin.from('reawakening_ai_filter_cache')
    .select('rejection_code_id, verdict, ai_note, enriched_rationale, enriched_task_title')
    .in('rejection_code_id', cases.map((c) => c.rejectionCodeId));
  const cached = new Map((cachedRows ?? []).map((r) => [r.rejection_code_id as string, r]));

  const out: RawFilterVerdict[] = [...cached.values()].map((r) => ({
    rejection_code_id: r.rejection_code_id as string, verdict: r.verdict as RawFilterVerdict['verdict'], ai_note: r.ai_note as string,
    enriched_rationale: (r.enriched_rationale as string | null) ?? undefined,
    enriched_task_title: (r.enriched_task_title as string | null) ?? undefined,
  }));
  const uncached = cases.filter((c) => !cached.has(c.rejectionCodeId));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (uncached.length > 0 && apiKey) {
    const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
    try {
      const fresh: RawFilterVerdict[] = [];
      for (const group of chunk(uncached)) {
        const verdicts = await callFilter(apiKey, model, group);
        for (const v of verdicts) if (group.some((c) => c.rejectionCodeId === v.rejection_code_id)) fresh.push(v);
      }
      if (fresh.length > 0) {
        await admin.from('reawakening_ai_filter_cache').upsert(
          fresh.map((v) => ({
            rejection_code_id: v.rejection_code_id, verdict: v.verdict, ai_note: v.ai_note,
            enriched_rationale: v.enriched_rationale ?? null, enriched_task_title: v.enriched_task_title ?? null,
          })),
          { onConflict: 'rejection_code_id', ignoreDuplicates: true },
        );
      }
      out.push(...fresh);
    } catch {
      // Fail-open (§4): a flaky/erroring call never caches anything and
      // never blocks the caller — the uncached cases simply come back
      // without a verdict, which applyFilterVerdicts treats as 'pass'.
    }
  }

  return NextResponse.json({ ok: true, verdicts: out });
}
