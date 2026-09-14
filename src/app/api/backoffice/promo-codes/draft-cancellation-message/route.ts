// Prompt 895 §C — "Draft with AI" for a promo code's cancellation message.
// Same composition pattern every other AI-assist route in this app uses
// (direct Anthropic call, one tool for structured output, logAiCall) —
// not the founder-facing /api/compose machine, on purpose: that one is
// gated behind a founder's own monthly Watson-draft quota and org context,
// neither of which applies to an admin drafting a notice for a promo code
// nobody's org owns. Drafts only — nothing is written here; the admin
// still reviews/edits and Confirm cancel (the PATCH route) is the one
// write.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAiCall } from '@/lib/ai-cost-log';
import { providerErrorMessage } from '@/lib/ai-provider-error';

const NOT_CONFIGURED_MSG = 'Set ANTHROPIC_API_KEY in the environment to enable AI drafting.';

async function callClaude(apiKey: string, model: string, code: string, label: string | null): Promise<string> {
  const prompt = [
    `Write the message a startup founder will see if they try to redeem the promo code "${code}"`,
    label ? `(internal label: "${label}", never shown to the founder)` : '',
    'after it has been cancelled.',
    '',
    'Example of the tone wanted: "This promo code has expired. Contact our support to check your',
    'situation or request a new one." Say the code is no longer valid, invite the reader to contact',
    'support, and do not sound like a technical error message. One or two short sentences.',
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      system: 'You write short, founder-facing product copy for a startup-fundraising platform. Warm but plain, '
        + 'never technical-sounding, never more than two sentences. You finish every request by calling the '
        + 'draft_cancellation_message tool.',
      messages: [{ role: 'user', content: prompt }],
      tools: [{
        name: 'draft_cancellation_message',
        description: 'Return the drafted cancellation message.',
        input_schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
      }],
      tool_choice: { type: 'tool', name: 'draft_cancellation_message' },
    }),
  });
  if (!res.ok) throw new Error(providerErrorMessage('[promo-codes/draft-cancellation-message]', await res.text(), 'AI draft failed — try again in a moment.'));
  const data = await res.json();
  await logAiCall({ route: '/api/backoffice/promo-codes/draft-cancellation-message', purpose: 'promo_cancellation_draft', model, usage: data.usage, orgId: null });
  const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('AI draft failed — try again in a moment.');
  return (toolUse.input as { message: string }).message;
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;

  const { code, label } = await req.json().catch(() => ({})) as { code?: string; label?: string | null };
  if (typeof code !== 'string' || !code.trim()) {
    return NextResponse.json({ ok: false, error: 'code is required.' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, message: NOT_CONFIGURED_MSG });

  try {
    const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
    const message = await callClaude(apiKey, model, code.trim(), label?.trim() || null);
    return NextResponse.json({ ok: true, configured: true, message });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
