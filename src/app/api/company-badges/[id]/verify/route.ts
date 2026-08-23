// Prompt 326 Pedido B — AI-assisted verification. Two inputs, both reusing
// mechanisms already built and in production, never a third: (1) a real
// web search (same tool config as entity-enrichment.ts's /api/entities/
// [id]/enrich), and (2) the evidence document, if attached, read via
// Claude's native PDF content block (same pattern as
// /api/data-room/nda-upload) — never a separate parser.
//
// Founder-triggered, synchronous: the honest choice per the prompt's own
// "decide by reading what's most honest for the founder" — an
// asynchronous background check would leave the badge sitting at
// 'unverified' with no visible activity, indistinguishable from "nothing
// happened yet" vs "still checking".
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { logAiCall } from '@/lib/ai-cost-log';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from '@/lib/prompt-injection-defense';
import { resolveBadgeVerification } from '@/lib/company-badges';

const NOT_CONFIGURED_MSG = 'AI-assisted badge verification isn’t available in your workspace yet.';

interface VerdictInput {
  foundCredibleConfirmation: boolean; foundContradiction: boolean; note: string;
}

async function callClaude(params: {
  apiKey: string; model: string; orgName: string; badgeName: string; badgeDescription: string | null; badgeYear: number | null;
  documentBase64: string | null; orgId: string;
}): Promise<VerdictInput> {
  const claimText = wrapDocumentContent(
    `Company: ${params.orgName}\nBadge/award claimed: ${params.badgeName}`
    + (params.badgeDescription ? `\nDescription: ${params.badgeDescription}` : '')
    + (params.badgeYear ? `\nYear: ${params.badgeYear}` : ''),
  );

  const content: unknown[] = [{ type: 'text', text: `Verify this claimed award/certification/milestone. ${claimText}` }];
  if (params.documentBase64) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: params.documentBase64 } });
    content.push({ type: 'text', text: 'The attached document is the founder\'s own supporting evidence for this claim.' });
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': params.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 1000,
      system: 'You verify a startup\'s claimed award, certification, or completed program/milestone. You search the public web '
        + '(and read an attached evidence document if given) for a credible confirmation or an active contradiction — you never '
        + 'fabricate a source, never rely on prior/training knowledge without a fresh check, and never treat an absence of '
        + 'evidence as either confirmation or contradiction (it is simply "not found"). You finish every check by calling the '
        + 'report_verification tool. ' + DOCUMENT_CONTENT_INSTRUCTION,
      messages: [{ role: 'user', content }],
      tools: params.documentBase64 ? [
        {
          name: 'report_verification',
          description: 'Report the verification outcome.',
          input_schema: {
            type: 'object',
            properties: {
              found_credible_confirmation: { type: 'boolean' },
              found_contradiction: { type: 'boolean' },
              note: { type: 'string', description: 'Short (max ~200 chars) explanation of what was found or not found.' },
            },
            required: ['found_credible_confirmation', 'found_contradiction', 'note'],
          },
        },
      ] : [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
        {
          name: 'report_verification',
          description: 'Report the verification outcome.',
          input_schema: {
            type: 'object',
            properties: {
              found_credible_confirmation: { type: 'boolean' },
              found_contradiction: { type: 'boolean' },
              note: { type: 'string', description: 'Short (max ~200 chars) explanation of what was found or not found.' },
            },
            required: ['found_credible_confirmation', 'found_contradiction', 'note'],
          },
        },
      ],
      tool_choice: { type: 'auto' },
    }),
  });
  if (!res.ok) throw new Error(providerErrorMessage('[company-badges/verify]', await res.text()));
  const data = await res.json();
  void logAiCall({ route: '/api/company-badges/[id]/verify', purpose: 'badge_verification', model: params.model, usage: data.usage, orgId: params.orgId });

  const toolUse = (data.content as { type: string; name?: string; input?: unknown }[])
    .filter((b) => b.type === 'tool_use' && b.name === 'report_verification').pop();
  if (!toolUse) return { foundCredibleConfirmation: false, foundContradiction: false, note: 'The AI did not return a verdict.' };
  const input = toolUse.input as { found_credible_confirmation: boolean; found_contradiction: boolean; note: string };
  return { foundCredibleConfirmation: !!input.found_credible_confirmation, foundContradiction: !!input.found_contradiction, note: input.note ?? '' };
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
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

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: badge } = await admin.from('company_badges').select('*').eq('id', params.id).eq('org_id', orgId).maybeSingle();
  if (!badge) return NextResponse.json({ ok: false, error: 'Badge not found.' }, { status: 404 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, message: NOT_CONFIGURED_MSG });

  const { data: org } = await admin.from('orgs').select('name').eq('id', orgId).maybeSingle();

  let documentBase64: string | null = null;
  if (badge.evidence_document_id) {
    const { data: doc } = await admin.from('documents').select('storage_path').eq('id', badge.evidence_document_id).eq('org_id', orgId).maybeSingle();
    if (doc?.storage_path) {
      const { data: fileBlob } = await admin.storage.from('data-room').download(doc.storage_path as string);
      if (fileBlob) documentBase64 = Buffer.from(await fileBlob.arrayBuffer()).toString('base64');
    }
  }

  try {
    const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
    const verdict = await callClaude({
      apiKey, model, orgId, orgName: (org?.name as string) ?? 'this company',
      badgeName: badge.name as string, badgeDescription: badge.description as string | null, badgeYear: badge.year as number | null,
      documentBase64,
    });
    const resolved = resolveBadgeVerification(verdict);

    const { error } = await admin.from('company_badges').update({
      verification_status: resolved.status, verification_note: resolved.note,
      verified_at: resolved.status === 'verified' ? new Date().toISOString() : null,
    }).eq('id', params.id).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, configured: true, status: resolved.status, note: resolved.note });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
