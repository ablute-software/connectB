// Prompt 66 — Form Assist. Server route: context in, a set of ready-to-copy
// answers out. Never touches the third-party form itself — the founder
// copies field-by-field. Same shape of work as /api/compose (context in,
// tool-forced Claude call, never invent beyond the given context), reused
// deliberately rather than building a second AI pipeline.
import { NextRequest, NextResponse } from 'next/server';
import { serverClient, resolveRole, authEnabled } from '@/lib/supabase-server';
import { resolveUserPlan } from '@/lib/plan-server';
import { planEntitlements, AI_COMPOSER_LOCKED_COPY } from '@/lib/plans';
import { logAiCall } from '@/lib/ai-cost-log';
import type { FormAssistContext } from '@/lib/form-assist';
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from '@/lib/prompt-injection-defense';
import { providerErrorMessage } from '@/lib/ai-provider-error';

const NOT_CONFIGURED_MSG =
  'Form Assist isn’t available in your workspace yet — fill the form yourself using the Company tab and Round card for reference.';

// Generic sections used when the founder hasn't pasted the form's own
// questions — covers the fields almost every investor web form asks for.
const DEFAULT_SECTIONS = [
  'About the company', 'Problem', 'Solution', 'Traction', 'Round & use of funds', 'Team', 'Links (deck / data room)',
];

function buildPrompt(context: FormAssistContext, pastedQuestions?: string) {
  const contextThin = context.companyFacts.length === 0;
  return [
    `Draft answers a founder can copy into an investor web-form submission (e.g. a Typeform) for ${context.startup.name}, applying to ${context.investor.entityName}.`,
    '',
    'CONTEXT (ground truth — do not invent beyond this):',
    // Prompt 305 §B — context can carry investor.thesis, a third party's own
    // text; pastedQuestions is founder-pasted, often copied straight off a
    // third-party form. Both wrapped as data.
    wrapDocumentContent(JSON.stringify(context, null, 2)),
    '',
    pastedQuestions
      ? `The founder pasted these exact questions from the real form — answer EACH one, in the same order, using its exact text as the "label" in your output:\n${wrapDocumentContent(pastedQuestions)}`
      : `No real form questions were provided — answer these generic sections instead, using each verbatim as the "label":\n${DEFAULT_SECTIONS.map((s) => `- ${s}`).join('\n')}`,
    '',
    'HARD RULES:',
    '- Never claim traction, revenue, headcount, or any number not present in the context.',
    '- If a section has thin or no supporting data in the context (e.g. companyFacts is empty, or round fields are mostly unset), still answer it generically/structurally, but set confidence low and say in the rationale what\'s missing — never fabricate specifics to fill the gap.',
    '- For a "Links" or "deck"/"data room" style question, reference that materials are available in the data room rather than inventing a URL — do not output a fake link.',
    '- Tone: formal and complete — this is often the investor\'s first real read of the company, not a casual message.',
    context.investor.thesis ? `- The investor's stated thesis is: "${context.investor.thesis}" — let it inform emphasis/framing where relevant, without misrepresenting the company.` : '',
    contextThin ? '- NOTE: no confirmed Company Canon facts exist yet for this company — lean on the org/round/traction fields given and flag in each rationale where a confirmed fact would sharpen the answer.' : '',
  ].filter(Boolean).join('\n');
}

interface FormAssistAnswer { label: string; answer: string; confidence: number; rationale: string }
interface FormAssistToolOutput { answers: FormAssistAnswer[] }

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      description: 'One entry per section/question, in the same order given.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'The section name or the exact pasted question this answers.' },
          answer: { type: 'string', description: 'The ready-to-copy answer text.' },
          confidence: { type: 'number', description: '0 to 1 — how well-grounded this answer is in the given context.' },
          rationale: { type: 'string', description: 'One short sentence: what context this drew on, or what\'s missing.' },
        },
        required: ['label', 'answer', 'confidence', 'rationale'],
      },
    },
  },
  required: ['answers'],
};

async function callClaude(apiKey: string, model: string, prompt: string, orgId: string | null): Promise<FormAssistToolOutput> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: 'You are helping a startup founder fill out an investor web-form submission. You produce ONE structured answer pack per call via the form_assist tool. Be specific and grounded, never generic filler, never invent facts beyond the given context. '
        + DOCUMENT_CONTENT_INSTRUCTION,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ name: 'form_assist', description: 'Return the drafted form answers.', input_schema: TOOL_SCHEMA }],
      tool_choice: { type: 'tool', name: 'form_assist' },
    }),
  });
  if (!res.ok) throw new Error(providerErrorMessage('[form-assist]', await res.text(), 'Form Assist draft failed — try again in a moment.'));
  const data = await res.json();
  // Prompt 469 §B — awaited: ai_call_log is used as an ACCEPTANCE
  // CRITERION (a missing entry has, more than once, been read as proof a
  // pipeline never ran), so losing an entry to a frozen serverless
  // instance invalidates a proof, not just a cost number. logAiCall
  // already swallows its own errors (ai-cost-log.ts) — awaiting it can
  // never fail this route, only add a Supabase insert's tens of
  // milliseconds against a model call that just took seconds. Do not
  // "optimize" this back to void.
  await logAiCall({ route: '/api/form-assist', purpose: 'form_assist_draft', model, usage: data.usage, orgId });
  const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Form Assist draft failed — try again in a moment.');
  return toolUse.input as FormAssistToolOutput;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { context, pastedQuestions } = body as { context: FormAssistContext; pastedQuestions?: string };
  if (!context) return NextResponse.json({ error: 'Missing context.' }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ configured: false, message: NOT_CONFIGURED_MSG }, { status: 200 });

  // Same plan gate as /api/compose — Form Assist is part of the AI-drafting
  // entitlement, not a separate one; a workspace that can't AI-draft
  // messages shouldn't get AI-drafted form answers either.
  let formAssistOrgId: string | null = null;
  if (authEnabled) {
    const sb = await serverClient();
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      const [role, { orgId, plan }] = await Promise.all([
        resolveRole(user.id, user.email, sb, user.email_confirmed_at),
        resolveUserPlan(user.id, sb),
      ]);
      formAssistOrgId = orgId ?? null;
      if (!planEntitlements(plan, role === 'developer').aiComposer) {
        return NextResponse.json({ configured: false, locked: true, message: AI_COMPOSER_LOCKED_COPY }, { status: 200 });
      }
    }
  }

  try {
    const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
    const draft = await callClaude(apiKey, model, buildPrompt(context, pastedQuestions?.trim() || undefined), formAssistOrgId);
    return NextResponse.json({ configured: true, answers: draft.answers });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
