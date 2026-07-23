// AI Review — server route calling an LLM. Availability mirrors /api/me's
// `capabilities.ai` exactly (same env check) — the UI checks that before
// ever calling this route, so reaching here unconfigured should be rare,
// but the fallback text still must never name the provider or env var.
// Guardrails: the AI never sends anything and never mutates CRM data — it returns a report.
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { kind, draft, context } = body as {
    kind: 'message_review' | 'deck_review' | 'one_pager_review' | 'market_data';
    draft?: string;
    context?: Record<string, unknown>;
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ configured: false, review: 'AI review isn’t available in your workspace yet.' }, { status: 200 });
  }

  const system =
    'You are an investor-outreach reviewer for ablute_, a Portuguese connected-health company raising a €1.3M seed. ' +
    'Hard rules you enforce in every review: line 1 must be a specific/recent/true hook; one small ask only; ' +
    'never claim traction, revenue or clinical results (the pilot is starting, not showing); respect the person\'s kill words; ' +
    'LinkedIn DMs under 900 characters; links only, never attachments; the product is positioned as wellness, never diagnostic. ' +
    'You produce a report — you never draft-and-send, and you flag rule violations bluntly.';

  const prompts: Record<string, string> = {
    message_review:
      `Review this outreach draft.\n\nDRAFT:\n${draft}\n\nCRM CONTEXT (ground truth):\n${JSON.stringify(context, null, 2)}\n\n` +
      'Return: 1) verdict (send / fix first / do not send), 2) hook strength 0-10 with why, 3) risks (kill words, framing, claims), ' +
      '4) ask check, 5) a tightened rewrite.',
    deck_review:
      `Review this investor deck content.\n\n${draft}\n\nScore 0-10 per dimension (problem clarity, traction evidence, ` +
      'number credibility, narrative, design notes if inferable), list issues with severity and slide/section, then top 5 rewrite suggestions.',
    one_pager_review: `Review this one-pager:\n\n${draft}\n\nSame format as a deck review, adapted to a single page.`,
    market_data:
      `Research brief request about an investor for outreach preparation:\n${JSON.stringify(context, null, 2)}\n\n` +
      'Summarise thesis, typical cheque, stage, recent relevant investments IF you are confident, and explicitly mark ' +
      'every item as needing verification. Do not invent specifics.',
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5',
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: prompts[kind] ?? prompts.message_review }],
      }),
    });
    if (!res.ok) {
      console.error('AI review provider error:', (await res.text()).slice(0, 300));
      return NextResponse.json({ error: 'AI review failed — try again in a moment.' }, { status: 502 });
    }
    const data = await res.json();
    const text = (data.content as { type: string; text?: string }[])
      .filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return NextResponse.json({ review: text });
  } catch (e) {
    console.error('AI review error:', e);
    return NextResponse.json({ error: 'AI review failed — try again in a moment.' }, { status: 500 });
  }
}
