// Prompt 327 Pedidos E/F — one shared AI-support mechanism for two call
// sites (Roadmap milestones, Round "Use of funds") — the same problem
// (suggest text from what the company's own data already says) in two
// places, never two parallel AI pipelines. Gated on
// blueprint_analyses.status='completed' for the org (ai-support-gate.ts) —
// the same "is there enough material" signal Blueprint/Readiness & Train
// already established, never a second readiness check invented here.
//
// Inputs reused, never rebuilt: accepted company_claims (the same
// knowledge base entity-enrichment/blueprint already read from), the org's
// own profile fields, and up to 3 clean Vault PDFs read via Claude's native
// PDF content block — the exact pattern nda-upload/route.ts already uses,
// wrapped in the same prompt-injection defense (wrapDocumentContent/
// DOCUMENT_CONTENT_INSTRUCTION, Prompt 305) entity-enrichment.ts's own
// route applies to untrusted text blocks.
//
// Never auto-applies: this route only ever returns suggestions for the
// founder to review — same "pastRound" discipline RoadmapCard.tsx already
// has for its own AI-adjacent hint (round-propagation.ts's detectPastRound),
// applied here to a real model call instead of a regex.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { logAiCall } from '@/lib/ai-cost-log';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from '@/lib/prompt-injection-defense';
import { hasCompletedBlueprintAnalysis } from '@/lib/ai-support-gate';

const NOT_CONFIGURED_MSG = 'AI support isn’t available in your workspace yet.';
const NOT_READY_MSG = 'There isn’t enough analyzed information yet — run Readiness & Train first, then come back for suggestions here.';
const MAX_DOCS = 3;

type Kind = 'roadmap' | 'use_of_funds';

async function callClaude(params: { apiKey: string; model: string; kind: Kind; contextText: string; documents: string[]; orgId: string }): Promise<string[]> {
  const isRoadmap = params.kind === 'roadmap';
  const taskLine = isRoadmap
    ? 'Suggest 3-6 short, concrete roadmap milestones/deliverables/events worth flagging (each one sentence, e.g. "Q2 2026 — Launch pilot with 3 design-partner clinics").'
    : 'Suggest 2-4 short, concrete bullet points for a "use of funds" statement (each one sentence, e.g. "40% engineering hires to ship the v2 platform").';

  const content: unknown[] = [{ type: 'text', text: `${taskLine}\n\n${wrapDocumentContent(params.contextText)}` }];
  for (const base64 of params.documents) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': params.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 1000,
      system: 'You help a startup founder draft ' + (isRoadmap ? 'roadmap milestones' : 'a "use of funds" statement')
        + ' from the company\'s own real information (claims, profile, attached documents) — never invented, never generic '
        + 'boilerplate unrelated to what was actually provided. If the material given is too thin to say anything concrete, '
        + 'call the tool with an empty array rather than padding with vague suggestions. ' + DOCUMENT_CONTENT_INSTRUCTION,
      messages: [{ role: 'user', content }],
      tools: [{
        name: 'suggest_text',
        description: 'Return the suggested short text items.',
        input_schema: { type: 'object', properties: { suggestions: { type: 'array', items: { type: 'string' } } }, required: ['suggestions'] },
      }],
      tool_choice: { type: 'auto' },
    }),
  });
  if (!res.ok) throw new Error(providerErrorMessage('[company/ai-support]', await res.text()));
  const data = await res.json();
  // Prompt 469 §B — awaited: ai_call_log is used as an ACCEPTANCE
  // CRITERION (a missing entry has, more than once, been read as proof a
  // pipeline never ran), so losing an entry to a frozen serverless
  // instance invalidates a proof, not just a cost number. logAiCall
  // already swallows its own errors (ai-cost-log.ts) — awaiting it can
  // never fail this route, only add a Supabase insert's tens of
  // milliseconds against a model call that just took seconds. Do not
  // "optimize" this back to void.
  await logAiCall({ route: '/api/company/ai-support', purpose: `ai_support_${params.kind}`, model: params.model, usage: data.usage, orgId: params.orgId });

  const toolUse = (data.content as { type: string; name?: string; input?: unknown }[])
    .filter((b) => b.type === 'tool_use' && b.name === 'suggest_text').pop();
  if (!toolUse) return [];
  return ((toolUse.input as { suggestions?: string[] }).suggestions ?? []).filter((s) => s?.trim());
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  const body = await req.json().catch(() => ({})) as { kind?: Kind };
  if (body.kind !== 'roadmap' && body.kind !== 'use_of_funds') return NextResponse.json({ ok: false, error: 'Missing or invalid kind.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: analysisRows, error: analysisErr } = await admin.from('blueprint_analyses').select('status').eq('org_id', orgId);
  if (analysisErr) return NextResponse.json({ ok: true, available: false, message: NOT_CONFIGURED_MSG });
  if (!hasCompletedBlueprintAnalysis(analysisRows ?? [])) {
    return NextResponse.json({ ok: true, available: false, message: NOT_READY_MSG });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, available: false, message: NOT_CONFIGURED_MSG });

  const [{ data: org }, { data: claims }, { data: docs }] = await Promise.all([
    admin.from('orgs').select('name, sectors, stage, one_liner, description, intro_problem, intro_solution').eq('id', orgId).maybeSingle(),
    admin.from('company_claims').select('statement').eq('org_id', orgId).eq('status', 'accepted'),
    admin.from('documents').select('id, name, storage_path').eq('org_id', orgId),
  ]);

  const contextLines = [
    org?.name ? `Company: ${org.name}` : null,
    org?.sectors?.length ? `Sectors: ${(org.sectors as string[]).join(', ')}` : null,
    org?.stage ? `Stage: ${org.stage}` : null,
    org?.one_liner ? `One-liner: ${org.one_liner}` : null,
    org?.description ? `Description: ${org.description}` : null,
    org?.intro_problem ? `Problem: ${org.intro_problem}` : null,
    org?.intro_solution ? `Solution: ${org.intro_solution}` : null,
    ...(claims ?? []).map((c) => `Claim: ${c.statement}`),
  ].filter(Boolean);

  // Up to 3 clean PDFs — same "list what's there, let the model decide
  // relevance" acceptance as gap-assist-sources.ts's own team-doc fallback,
  // scaled down since this isn't targeted at one specific gap.
  const documentBase64: string[] = [];
  for (const doc of (docs ?? []).slice(0, MAX_DOCS)) {
    if (!doc.storage_path || !(doc.storage_path as string).toLowerCase().endsWith('.pdf')) continue;
    const { data: fileBlob } = await admin.storage.from('data-room').download(doc.storage_path as string);
    if (fileBlob) documentBase64.push(Buffer.from(await fileBlob.arrayBuffer()).toString('base64'));
  }

  try {
    const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
    const suggestions = await callClaude({ apiKey, model, kind: body.kind, contextText: contextLines.join('\n'), documents: documentBase64, orgId });
    return NextResponse.json({ ok: true, available: true, suggestions });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
