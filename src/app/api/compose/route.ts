// IRM_SPEC §8b — AI outreach composer. Server route: context in, structured
// draft out. Never sends or stores anything — the founder reviews and saves
// via the existing /log flow. Draft-only, no autonomous dispatch anywhere.
import { NextRequest, NextResponse } from 'next/server';
import { lintMessage } from '@/lib/rules';
import type { ComposerContext, ComposerIntent } from '@/lib/composer';
import type { Channel, Entity, Person } from '@/lib/types';

const NOT_CONFIGURED_MSG =
  'AI drafting isn’t available in your workspace yet — compose the message yourself. ' +
  'The linter and pre-flight checks below still apply.';

const CHANNEL_GUIDANCE: Record<Channel, string> = {
  linkedin_dm: 'LinkedIn DM: under 900 characters, no links to editable docs, conversational.',
  linkedin_note: 'LinkedIn connection note: very short (under 300 characters), no ask yet — just the reason to connect.',
  email: 'Email: include a short subject line, keep the body under ~150 words, one clear ask.',
  web_form: 'Web form submission: formal, complete, no informalities — this is often the first read.',
  call: 'Call talking points: bullet-style opening lines, not a script to read verbatim.',
  meeting: 'Meeting follow-up or confirmation: reference what was discussed, confirm next step.',
  event: 'Event follow-up: reference where you met, keep it light.',
  intro: 'Warm intro message (to the connector or the target): thank the connector, or open warmly referencing them.',
  stage_change: 'N/A',
};

const INTENT_GUIDANCE: Record<ComposerIntent, string> = {
  first_touch: 'This is the FIRST message ever sent to this person. Open with a specific, true, recent hook about them — never generic. State the one small ask clearly.',
  follow_up: 'This is a FOLLOW-UP after a period of silence. Do not repeat the first message verbatim. Reference the earlier note briefly, add one new piece of information or angle, keep the ask the same and small.',
  reply: 'This REPLIES to their most recent inbound message (see prior thread). Address what they actually said — do not ignore it or restate the pitch from scratch.',
  meeting_ask: 'Propose or confirm a specific meeting — suggest 2-3 concrete time windows, keep logistics simple.',
};

function buildPrompt(context: ComposerContext, channel: Channel, intent: ComposerIntent) {
  return [
    `Compose a single outreach message for ${context.startup.name} to send to ${context.person.fullName}` +
      (context.person.role ? ` (${context.person.role})` : '') + ` at ${context.investor.entityName}.`,
    '',
    `INTENT: ${intent} — ${INTENT_GUIDANCE[intent]}`,
    `CHANNEL: ${channel} — ${CHANNEL_GUIDANCE[channel]}`,
    context.person.preferredLanguage === 'pt' ? 'Write in European Portuguese.' : 'Write in English.',
    '',
    'CONTEXT (ground truth — do not invent beyond this):',
    JSON.stringify(context, null, 2),
    '',
    'HARD RULES:',
    '- Never claim traction, revenue, or clinical results that are not in the context.',
    `- Never use these kill words for this person: ${context.person.killWords.join(', ') || '(none)'}.`,
    '- One ask only, and keep it small.',
    '- Line 1 must reference something specific/true/recent about this person or fund — never a generic opener.',
    '- Never include an editable document link (no "/edit" URLs).',
    context.constraints.locked ? `- NOTE: this entity is contact-locked until ${context.constraints.lockUntil?.slice(0, 10)} — draft anyway for prep, but flag this in the rationale.` : '',
    context.constraints.thirdUnansweredRisk ? '- NOTE: two prior messages already went unanswered — this would be a third. Strongly consider proposing to hold instead of drafting a third message; say so in the rationale.' : '',
  ].filter(Boolean).join('\n');
}

async function callClaude(apiKey: string, model: string, prompt: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system: 'You are an investor-outreach copywriter for a startup founder. You produce ONE structured draft per call via the compose_outreach tool — you never send anything, you only draft. Be specific, never generic; respect every hard rule given.',
      messages: [{ role: 'user', content: prompt }],
      tools: [{
        name: 'compose_outreach',
        description: 'Return the composed outreach draft.',
        input_schema: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'Email subject line; empty string for non-email channels.' },
            body: { type: 'string', description: 'The full message body.' },
            rationale: { type: 'string', description: 'One or two sentences: which hooks/context were used, and why.' },
            confidence: { type: 'number', description: '0 to 1 — how confident this draft is ready to send as-is.' },
          },
          required: ['subject', 'body', 'rationale', 'confidence'],
        },
      }],
      tool_choice: { type: 'tool', name: 'compose_outreach' },
    }),
  });
  if (!res.ok) {
    console.error('AI compose provider error:', (await res.text()).slice(0, 300));
    throw new Error('AI draft failed — try again in a moment.');
  }
  const data = await res.json();
  const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('AI draft failed — try again in a moment.');
  return toolUse.input as { subject: string; body: string; rationale: string; confidence: number };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { context, channel, intent } = body as { context: ComposerContext; channel: Channel; intent: ComposerIntent };
  if (!context || !channel || !intent) {
    return NextResponse.json({ error: 'Missing context, channel, or intent.' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ configured: false, message: NOT_CONFIGURED_MSG }, { status: 200 });
  }

  // Minimal Person/Entity shapes for the existing lintMessage() — it only
  // reads these fields, but rules.ts stays untouched so we satisfy its types
  // with a narrow reconstruction rather than widening the function signature.
  const personLike = {
    full_name: context.person.fullName, kill_words: context.person.killWords, hook: context.person.hook,
  } as Person;
  const entityLike = { name: context.investor.entityName, the_ask: context.investor.theAsk } as Entity;

  try {
    const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
    let draft = await callClaude(apiKey, model, buildPrompt(context, channel, intent));
    let findings = lintMessage(draft.body, personLike, entityLike, channel);

    if (findings.some((f) => f.severity === 'error')) {
      const retryPrompt = buildPrompt(context, channel, intent) +
        `\n\nYour previous attempt failed these checks — fix them:\n${findings.filter((f) => f.severity === 'error').map((f) => `- ${f.message}`).join('\n')}`;
      draft = await callClaude(apiKey, model, retryPrompt);
      findings = lintMessage(draft.body, personLike, entityLike, channel);
    }

    return NextResponse.json({ configured: true, draft, lint: findings, model });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
