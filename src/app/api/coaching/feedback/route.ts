// Prompt 99 §4 — "Train" coaching session: end of a Q&A round, the app
// grades each answer and gives an overall summary. Same forced-tool-call
// pattern as /api/ai-review and /api/review/investability; writes to
// coaching_runs via the service-role client since its RLS is SELECT-only
// (same pattern as review_runs — see 0094's own comment).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { logAiCall } from '@/lib/ai-cost-log';
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from '@/lib/prompt-injection-defense';
import { providerErrorMessage } from '@/lib/ai-provider-error';

interface Question { text: string; category: string; source: 'fixed' | 'derived' | 'diligence' }
interface QA { question: Question; answer: string }

export async function POST(req: Request) {
  const { qas, context } = await req.json() as { qas: QA[]; context?: Record<string, unknown> };
  if (!qas?.length) return NextResponse.json({ ok: false, error: 'No answers to grade.' }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, message: 'AI review isn’t available in your workspace yet.' });

  const prompt =
    'You just role-played an investor asking a founder these questions in a diligence session. Grade each answer — what it '
    + 'covered well, what it missed — and give a short overall summary. Never invent facts about the company beyond what the '
    + `answers themselves say.\n\nCOMPANY CONTEXT:\n${wrapDocumentContent(JSON.stringify(context ?? {}, null, 2))}\n\n`
    + wrapDocumentContent(qas.map((qa, i) => `Q${i + 1} [${qa.question.category}]: ${qa.question.text}\nA${i + 1}: ${qa.answer}`).join('\n\n'))
    + '\n\nAlways finish by calling report_coaching.';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5',
        max_tokens: 1800,
        system: 'You are an investor-pitch coach for an early-stage founder. You never invent facts, you never send or '
          + 'mutate anything — you only give per-answer feedback and an overall summary, always via the report_coaching tool. '
          + DOCUMENT_CONTENT_INSTRUCTION,
        messages: [{ role: 'user', content: prompt }],
        tools: [{
          name: 'report_coaching',
          description: 'Return per-question feedback and an overall session summary.',
          input_schema: {
            type: 'object',
            properties: {
              per_question: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { note: { type: 'string', description: 'Short: what was missing, what was good.' } },
                  required: ['note'],
                },
                description: 'Same order and length as the questions given.',
              },
              strengths_to_keep: { type: 'array', items: { type: 'string' } },
              top_adjustments: { type: 'array', items: { type: 'string' }, description: '2-3 most important adjustments for next time.' },
            },
            required: ['per_question', 'strengths_to_keep', 'top_adjustments'],
          },
        }],
        tool_choice: { type: 'tool', name: 'report_coaching' },
      }),
    });
    if (!res.ok) {
      const message = providerErrorMessage('[coaching/feedback]', await res.text(), 'Feedback failed — try again in a moment.');
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }
    const data = await res.json();
    void logAiCall({ route: '/api/coaching/feedback', purpose: 'coaching_feedback', model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5', usage: data.usage, orgId: member.org_id });
    const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
    const feedback = toolUse?.input as { per_question: { note: string }[]; strengths_to_keep: string[]; top_adjustments: string[] } | undefined;
    if (!feedback) return NextResponse.json({ ok: false, error: 'Feedback failed — try again in a moment.' }, { status: 502 });

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: row, error } = await admin.from('coaching_runs').insert({
      org_id: member.org_id,
      questions: qas.map((qa) => qa.question),
      answers: qas.map((qa) => qa.answer),
      feedback, created_by: user.id,
    }).select().single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, run: row });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
