// Investor profile enrichment — the real fix behind the entity page's
// "Request more info" affordance, which previously only wrote a demand-flag
// contribution and never looked anything up (see DECISIONS.md). Founder-
// facing, single-entity, on-demand — no scheduled/background job.
//
// Modeled directly on /api/backoffice/research (§6b-3), but org-scoped by
// entity id (any org member may enrich their own org's entity) rather than
// platform-admin/name-matched across orgs. Real web lookup only — the model
// is instructed to use its web_search tool, never its own training data —
// then every candidate value is run through entity-enrichment.ts's
// allowlist + non-clobbering + type-coercion pipeline before being stored,
// so a hallucinated field name or an already-known field can never reach
// the database, let alone overwrite founder-entered data. Every surviving
// proposal is inserted as an UNCONFIRMED contributions row (source:'ai',
// status:'submitted') for the founder to accept/reject in ContributionBox —
// nothing here ever writes directly to the entity.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { buildEntityEnrichmentPrompt, knownEnrichmentValues, prepareEnrichmentProposals, type RawProposal } from '@/lib/entity-enrichment';
import type { Entity } from '@/lib/types';

const NOT_CONFIGURED_MSG = 'AI-assisted enrichment isn’t available in your workspace yet.';

async function callClaude(apiKey: string, model: string, prompt: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: 'You are a research assistant for a venture/angel investor database. You search the public web and propose '
        + 'factual field values with sources — you never fabricate, never rely on prior/training knowledge without verifying it '
        + 'via a fresh web search, never scrape gated/private content, and never treat inference as fact. You finish every '
        + 'research task by calling the propose_fields tool, even if you found nothing (call it with an empty array).',
      messages: [{ role: 'user', content: prompt }],
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
        {
          name: 'propose_fields',
          description: 'Return the researched field proposals, each with a real source URL and a confidence 0-1.',
          input_schema: {
            type: 'object',
            properties: {
              proposals: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string' },
                    value: { type: 'string' },
                    confidence: { type: 'number' },
                    source_url: { type: 'string' },
                  },
                  required: ['field', 'value', 'confidence', 'source_url'],
                },
              },
            },
            required: ['proposals'],
          },
        },
      ],
      tool_choice: { type: 'auto' },
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const toolUse = (data.content as { type: string; name?: string; input?: unknown }[])
    .filter((b) => b.type === 'tool_use' && b.name === 'propose_fields').pop();
  if (!toolUse) return [] as RawProposal[];
  return ((toolUse.input as { proposals: RawProposal[] }).proposals ?? []);
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: entity, error: entityErr } = await admin.from('entities').select('*').eq('id', id).maybeSingle();
  if (entityErr || !entity) return NextResponse.json({ ok: false, error: entityErr?.message ?? 'Entity not found.' }, { status: 404 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', entity.org_id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, message: NOT_CONFIGURED_MSG });

  try {
    const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
    const known = knownEnrichmentValues(entity as Entity);
    const raw = await callClaude(apiKey, model, buildEntityEnrichmentPrompt(entity.name as string, known));
    const proposals = prepareEnrichmentProposals(entity as Entity, raw);

    if (proposals.length === 0) {
      return NextResponse.json({ ok: true, configured: true, count: 0, message: 'No confident findings from a public web search.' });
    }

    const rows = proposals.map((p) => ({
      subject_type: 'entity' as const, subject_id: entity.id, org_id: entity.org_id,
      field: p.field, value: p.value, source: 'ai' as const, confidence: p.confidence, source_url: p.source_url,
      note: 'AI-sourced via Request more info', status: 'submitted' as const,
    }));
    const { error: insErr } = await admin.from('contributions').insert(rows);
    if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, configured: true, count: proposals.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
