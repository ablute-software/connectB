// Prompt 528 §2 — "Structured update" showed four empty boxes and suggested
// nothing. This fills ONE of them, from what the company has already told the
// platform, so the founder starts from a sentence they can edit rather than a
// blank form.
//
// Reuses the roadmap/suggest-events architecture wholesale — same closed set
// of founder-authored sources, same knowledge-signature caching idea, same
// forced tool_use, same logAiCall discipline — rather than inventing a second
// way to answer "what is worth saying about this company".
//
// ROOT PRIVACY RULE, verified before writing: every source read here is
// founder-authored (org profile, badges, funding rounds already closed,
// document extractions, existing roadmap events). Nothing about platform
// performance, outreach, pipeline, passes or replies is read — grep this file
// for `entities`, `interactions` or `tasks` and you will find nothing.
//
// AND ONE DELIBERATE OMISSION beyond that: round_target_eur and
// round_target_close_date are NOT read, though the roadmap builder does read
// them. The composer this feeds states "No round/funding field, on purpose";
// a suggestion button that could reintroduce the round would overrule the
// form's own rule. Omitted at the source, so no instruction has to hold.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { documentExtractionsAvailable } from '@/lib/document-extraction-capability';
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from '@/lib/prompt-injection-defense';
import { logAiCall } from '@/lib/ai-cost-log';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import {
  UPDATE_SUGGEST_SYSTEM, UPDATE_SUGGEST_TOOL_SCHEMA, toUpdateSuggestion,
} from '@/lib/network-update-suggest';

export const maxDuration = 60;

const ROUTE = '/api/network/update/suggest';
const MAX_ITEMS = 40;

async function buildKnowledge(admin: SupabaseClient, orgId: string): Promise<string[]> {
  const [{ data: org }, { data: badges }, { data: rounds }, extractionsAvail, { data: roadmapRows }] = await Promise.all([
    // founded_year and one_liner only — NOT round_target_eur /
    // round_target_close_date, unlike roadmap/suggest-events. See header.
    admin.from('orgs').select('founded_year, one_liner').eq('id', orgId).maybeSingle(),
    admin.from('company_badges').select('name, year, verification_status').eq('org_id', orgId),
    admin.from('funding_rounds').select('label, closed_year, investor_name').eq('org_id', orgId),
    documentExtractionsAvailable(),
    admin.from('roadmap_events').select('title, date').eq('org_id', orgId),
  ]);

  const items: string[] = [];
  const orgRow = org as { founded_year: number | null; one_liner: string | null } | null;
  if (orgRow?.one_liner) items.push(`What the company does: ${orgRow.one_liner}`);
  if (orgRow?.founded_year) items.push(`Founded in ${orgRow.founded_year}.`);

  for (const b of (badges ?? []) as { name: string; year: number | null; verification_status: string }[]) {
    items.push(`Award or programme: "${b.name}"${b.year ? `, ${b.year}` : ''} (${b.verification_status}).`);
  }

  // Closed rounds are history the founder already published, not the round
  // being raised — the amount is deliberately left out all the same, so a
  // suggestion cannot turn into a funding sentence.
  for (const r of (rounds ?? []) as { label: string | null; closed_year: number | null; investor_name: string | null }[]) {
    items.push(`Past milestone: ${r.label ?? 'a financing'}${r.closed_year ? ` in ${r.closed_year}` : ''}${r.investor_name ? ` with ${r.investor_name}` : ''}.`);
  }

  for (const e of (roadmapRows ?? []) as { title: string; date: string }[]) {
    items.push(`Roadmap event: "${e.title}" on ${e.date}.`);
  }

  if (extractionsAvail) {
    const { data: extractions } = await admin.from('document_extractions')
      .select('document_id, extracted').eq('org_id', orgId).eq('status', 'completed');
    const { data: docs } = await admin.from('documents').select('id, name').eq('org_id', orgId);
    const nameById = new Map((docs ?? []).map((d) => [d.id as string, d.name as string]));
    for (const e of (extractions ?? []) as { document_id: string; extracted: Record<string, unknown> }[]) {
      const ex = e.extracted;
      const parts: string[] = [`Document "${nameById.get(e.document_id) ?? 'a document'}"`];
      if (ex.documentType) parts.push(`type: ${ex.documentType as string}`);
      for (const p of (ex.programs as { name: string }[] | undefined) ?? []) parts.push(`programme: ${p.name}`);
      for (const d of (ex.dates as { label: string; date: string }[] | undefined) ?? []) parts.push(`${d.label}: ${d.date}`);
      items.push(parts.join(', ') + '.');
    }
  }

  return items.slice(0, MAX_ITEMS);
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !serviceKey || !apiKey) return NextResponse.json({ ok: true, available: false });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Founders only.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const items = await buildKnowledge(admin, orgId);
  if (items.length === 0) {
    // Nothing on file is not a failure — it is the honest answer, and it
    // stops a model being asked to write about a company it knows nothing
    // about, which is exactly how invented progress gets published.
    return NextResponse.json({
      ok: true, available: false,
      reason: 'Sherlock has nothing on file to draw on yet — add a badge, a document or a roadmap event first.',
    });
  }

  try {
    const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 700, system: UPDATE_SUGGEST_SYSTEM,
        messages: [{
          role: 'user',
          content: [{
            type: 'text',
            text: `${DOCUMENT_CONTENT_INSTRUCTION}\n\n${wrapDocumentContent(items.join('\n'))}\n\n`
              + 'Choose the single section best supported by these facts and draft it.',
          }],
        }],
        tools: [{
          name: 'report_update_suggestion',
          description: 'Report the chosen section, the drafted sentences, and what they came from.',
          input_schema: UPDATE_SUGGEST_TOOL_SCHEMA,
        }],
        tool_choice: { type: 'tool', name: 'report_update_suggestion' },
      }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: providerErrorMessage(`[${ROUTE}]`, await res.text()) }, { status: 502 },
      );
    }
    const data = await res.json();
    await logAiCall({ route: ROUTE, purpose: 'network_update_suggest', model, usage: data.usage, orgId });

    const toolUse = (data.content as { type: string; name?: string; input?: unknown }[])
      .filter((b) => b.type === 'tool_use' && b.name === 'report_update_suggestion').pop();
    const suggestion = toUpdateSuggestion(toolUse?.input);
    if (!suggestion) {
      return NextResponse.json({
        ok: true, available: false,
        reason: 'Sherlock could not draft anything it could stand behind from what is on file.',
      });
    }

    // Never writes: not to network_posts, not to any pending-suggestions
    // table. This is a draft filling a form the founder is already looking at,
    // not a queue to review later.
    return NextResponse.json({ ok: true, available: true, ...suggestion });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
