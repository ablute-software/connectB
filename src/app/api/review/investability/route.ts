// Batch 3 A / IRM_SPEC §11f (partial MVP) — investability ranking. Consumes
// the org's confirmed canon facts + pipeline stats, asks the model for a
// structured verdict (score + strengths/weaknesses/opportunities/threats/
// risks/recommendations via a forced tool call, so the shape is guaranteed),
// and stores the run in review_runs so the founder can see the ranking
// evolve over time. The AI never mutates CRM data — it produces a report;
// acting on it is the founder's.
//
// Prompt 166 §A — opportunities/threats added alongside the original four
// fields: strategic/external categories, deliberately distinct from
// risks/recommendations (internal/operational) per Nuno's decision. Prompt
// 166 §B added the monthly quota check below (REVIEW_QUOTA in plans.ts).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { resolveUserPlan } from '@/lib/plan-server';
import { REVIEW_QUOTA, REVIEW_OPTIMIZATION_PREVIEW_COPY } from '@/lib/plans';
import type { SwotData } from '@/lib/types';

interface Report extends SwotData {
  score: number; summary: string;
  risks: string[]; recommendations: string[];
}

export async function POST(req: Request) {
  const { facts, pipeline, company } = await req.json() as {
    facts?: string[]; pipeline?: Record<string, unknown>; company?: Record<string, unknown>;
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const [role, { orgId, plan }] = await Promise.all([
    resolveRole(user.id, user.email, sb, user.email_confirmed_at),
    resolveUserPlan(user.id, sb),
  ]);
  if (!orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, message: 'AI review isn’t available in your workspace yet.' });

  // Prompt 166 §B — monthly review quota, per the STARTUP's plan
  // (REVIEW_QUOTA in plans.ts). Checked BEFORE calling the Anthropic API so
  // a blocked request never spends tokens. The platform org (developer
  // role) is exempt, same spirit as the Watson quota gate in /api/compose.
  // review_runs.created_at is the quota's own source of truth — no separate
  // counter/reset column, unlike Watson's rolling window — so this always
  // reflects a genuine calendar-month count with nothing to drift or reset.
  if (role !== 'developer') {
    const quota = REVIEW_QUOTA[plan];
    if (quota !== null) {
      if (quota === 0) {
        return NextResponse.json({ ok: false, error: REVIEW_OPTIMIZATION_PREVIEW_COPY }, { status: 200 });
      }
      const now = new Date();
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const { count } = await sb.from('review_runs').select('id', { count: 'exact', head: true })
        .eq('org_id', orgId).gte('created_at', startOfMonth);
      if ((count ?? 0) >= quota) {
        return NextResponse.json({
          ok: false,
          error: `You've used your ${quota} review${quota === 1 ? '' : 's'} this month — resets on the 1st.`,
        }, { status: 200 });
      }
    }
  }

  const prompt =
    'Assess this startup\'s investability (readiness to raise vs the value of the round it wants) using ONLY the '
    + 'confirmed company facts and pipeline stats below — never invent facts not present.\n\n'
    + `COMPANY:\n${JSON.stringify(company ?? {}, null, 2)}\n\n`
    + `CONFIRMED FACTS:\n${(facts ?? []).map((f) => `- ${f}`).join('\n') || '(none confirmed yet)'}\n\n`
    + `PIPELINE STATS:\n${JSON.stringify(pipeline ?? {}, null, 2)}\n\n`
    + 'Score 0-100 (readiness vs round value). Be concrete and specific to what the facts actually say; if the canon '
    + 'is thin, say so and score conservatively. Also identify Opportunities (external, strategic openings this startup '
    + 'could pursue — market timing, a gap a competitor left open, a partnership angle) and Threats (external, '
    + 'strategic risks — a competitor raising a larger round, a market or regulatory shift against this startup) — '
    + 'distinct from Risks/Recommendations, which stay internal/operational. Same discipline throughout: only from '
    + 'confirmed facts, never invented. Always finish by calling report_investability.';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5',
        max_tokens: 1500,
        system: 'You are an investability analyst for an early-stage startup founder. You produce a structured, honest '
          + 'readiness assessment grounded strictly in the facts given — no invented traction, revenue, or clinical claims. '
          + 'Opportunities and Threats are external/strategic (the market, competitors, timing) — never restate an '
          + 'internal Weakness as a Threat or an internal fix as an Opportunity. You never send or mutate anything; you '
          + 'return a report.',
        messages: [{ role: 'user', content: prompt }],
        tools: [{
          name: 'report_investability',
          description: 'Return the structured investability assessment.',
          input_schema: {
            type: 'object',
            properties: {
              score: { type: 'number', description: '0-100 readiness vs round value.' },
              summary: { type: 'string', description: 'One or two sentences: the headline verdict.' },
              strengths: { type: 'array', items: { type: 'string' } },
              weaknesses: { type: 'array', items: { type: 'string' } },
              opportunities: {
                type: 'array', items: { type: 'string' },
                description: 'External, strategic openings this startup could pursue (market gap, timing, partnership) — never invented, only what the facts support.',
              },
              threats: {
                type: 'array', items: { type: 'string' },
                description: 'External, strategic threats (a competitor\'s move, a market or regulatory shift) — distinct from `risks`, which are this startup\'s own internal/operational risks.',
              },
              risks: { type: 'array', items: { type: 'string' } },
              recommendations: { type: 'array', items: { type: 'string' }, description: 'Concrete things to improve, most impactful first.' },
            },
            required: ['score', 'summary', 'strengths', 'weaknesses', 'opportunities', 'threats', 'risks', 'recommendations'],
          },
        }],
        tool_choice: { type: 'tool', name: 'report_investability' },
      }),
    });
    if (!res.ok) {
      console.error('Investability review provider error:', (await res.text()).slice(0, 300));
      return NextResponse.json({ ok: false, error: 'AI review failed — try again in a moment.' }, { status: 502 });
    }
    const data = await res.json();
    const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
    const report = toolUse?.input as Report | undefined;
    if (!report) return NextResponse.json({ ok: false, error: 'AI review failed — try again in a moment.' }, { status: 502 });

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: row, error } = await admin.from('review_runs').insert({
      org_id: orgId, score: Math.round(report.score), summary: report.summary,
      report, created_by: user.id,
    }).select().single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, run: row });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
