// AI Review — server route calling an LLM. Availability mirrors /api/me's
// `capabilities.ai` exactly (same env check) — the UI checks that before
// ever calling this route, so reaching here unconfigured should be rare,
// but the fallback text still must never name the provider or env var.
// Guardrails: the AI never sends anything and never mutates CRM data — it returns a report.
//
// Prompt 99 §3 — two changes from the original version: (1) every review is
// now persisted to ai_reviews (previously never inserted anywhere, table sat
// at 0 rows), same pattern /api/review/investability already uses for
// review_runs; (2) output is a forced tool-call (a guaranteed shape), not
// free text, so the Treinar tab (§4) can read weaknesses/risks as data.
// Addenda ai_review_kind: every kind now receives `context`
// (stage/sectors/country/round_target_eur) and calibrates its criteria to
// stage — previously only market_data got context at all; deck_review and
// one_pager_review had none. Each weakness/risk/recommendation is tagged
// with a company_facts.category value (Fase 1 of the ecosystem-intelligence
// groundwork the addendum asked for — no new taxonomy).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

type ReviewKind =
  | 'message_review' | 'deck_review' | 'one_pager_review' | 'market_data'
  | 'business_plan_review' | 'financial_plan_review' | 'marketing_plan_review' | 'cap_table_review';

const STRUCTURED_KINDS: ReviewKind[] = [
  'deck_review', 'one_pager_review', 'business_plan_review',
  'financial_plan_review', 'marketing_plan_review', 'cap_table_review',
];

const CATEGORIES = ['product', 'traction', 'team', 'positioning', 'financing', 'regulatory', 'market', 'metrics', 'other'] as const;

interface CompanyContext {
  name?: string; sector?: string; stage?: string; country?: string; round_target_eur?: number; one_liner?: string;
}

interface Finding { text: string; category: typeof CATEGORIES[number] }
interface Weakness extends Finding { severity: 'low' | 'medium' | 'high' }
interface Risk extends Finding { severity: 'low' | 'medium' | 'high' }
interface StructuredReport {
  score: number; summary: string;
  strengths: string[]; weaknesses: Weakness[]; risks: Risk[]; recommendations: Finding[];
}

// Addenda ai_review_kind §1 — the ruler moves with the stage; a thin plan at
// pre-seed is expected, the same thin plan at Series B is a red flag.
function stageGuidance(stage?: string): string {
  switch (stage) {
    case 'pre_seed':
    case 'seed':
      return 'STAGE CONTEXT (pre-seed/seed): what matters is team credibility, clarity of problem/solution, and a plausible '
        + 'plan — weak or absent numbers are expected here; judge the founder\'s clarity about what is not yet known, not the numbers themselves.';
    case 'series_a':
      return 'STAGE CONTEXT (Series A): the bar shifts from "credible plan" to "repeatable proof" — real traction, early '
        + 'unit economics (even if not yet optimized), a first acquisition channel shown to work more than once.';
    case 'series_b':
      return 'STAGE CONTEXT (Series B): expect a clear path to profitability or capital efficiency, a multi-year financial '
        + 'model with cohort retention (not just aggregate totals), evidence growth is intentional not accidental, and some governance maturity.';
    case 'series_c_plus':
      return 'STAGE CONTEXT (Series C+/growth): focus shifts to the expansion thesis (new market/product/geography), capital '
        + 'efficiency vs sector peers, and readiness for the next step (acquisition, IPO, a larger round) — "does this scale with discipline", not "can this work".';
    default:
      return 'STAGE CONTEXT: stage not specified — do not assume seed by default; calibrate conservatively and say so.';
  }
}

function contextBlock(context?: CompanyContext): string {
  if (!context) return 'COMPANY CONTEXT: none provided.';
  return `COMPANY CONTEXT:\n${JSON.stringify(context, null, 2)}\n\n${stageGuidance(context.stage)}`;
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    category: { type: 'string', enum: CATEGORIES as unknown as string[] },
  },
  required: ['text', 'category'],
};
const SEVERITY_FINDING_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    category: { type: 'string', enum: CATEGORIES as unknown as string[] },
    severity: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['text', 'category', 'severity'],
};
const REPORT_TOOL = {
  name: 'report_review',
  description: 'Return the structured review report.',
  input_schema: {
    type: 'object',
    properties: {
      score: { type: 'number', description: '0-10.' },
      summary: { type: 'string', description: 'One or two sentences: the headline verdict.' },
      strengths: { type: 'array', items: { type: 'string' } },
      weaknesses: { type: 'array', items: SEVERITY_FINDING_SCHEMA },
      risks: { type: 'array', items: SEVERITY_FINDING_SCHEMA },
      recommendations: { type: 'array', items: FINDING_SCHEMA, description: 'Concrete, most impactful first.' },
    },
    required: ['score', 'summary', 'strengths', 'weaknesses', 'risks', 'recommendations'],
  },
};

export async function POST(req: Request) {
  const body = await req.json();
  const { kind, draft, context } = body as { kind: ReviewKind; draft?: string; context?: CompanyContext };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ configured: false, review: 'AI review isn’t available in your workspace yet.' }, { status: 200 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: member } = user ? await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle() : { data: null };

  // The prompt of every kind below is written generically (stage/sector/etc
  // via `context`, never a hardcoded company name or sector) — see the note
  // on the system prompt just below about NOT extending that generalization
  // to the pre-existing message_review prompt yet.
  const system =
    'You are an investor-readiness reviewer for an early-stage startup founder. You produce a structured, honest report '
    + 'grounded strictly in what is given — never invent traction, revenue, customers, or clinical/regulatory claims not '
    + 'present in the input. You never send or mutate anything; you always return a report, and you flag rule violations bluntly.';

  // message_review keeps its original, ablute_-specific system prompt
  // untouched (Prompt 99 §3.4 — flagged, not fixed: generalizing this one
  // is out of scope while ablute_ is the only real user).
  const messageReviewSystem =
    'You are an investor-outreach reviewer for ablute_, a Portuguese connected-health company raising a €1.3M seed. '
    + 'Hard rules you enforce in every review: line 1 must be a specific/recent/true hook; one small ask only; '
    + 'never claim traction, revenue or clinical results (the pilot is starting, not showing); respect the person\'s kill words; '
    + 'LinkedIn DMs under 900 characters; links only, never attachments; the product is positioned as wellness, never diagnostic. '
    + 'You produce a report — you never draft-and-send, and you flag rule violations bluntly.';

  const prompts: Record<ReviewKind, string> = {
    message_review:
      `Review this outreach draft.\n\nDRAFT:\n${draft}\n\nCRM CONTEXT (ground truth):\n${JSON.stringify(context, null, 2)}\n\n`
      + 'Return: 1) verdict (send / fix first / do not send), 2) hook strength 0-10 with why, 3) risks (kill words, framing, claims), '
      + '4) ask check, 5) a tightened rewrite.',
    deck_review:
      `${contextBlock(context)}\n\nReview this investor deck content, from an investor's point of view.\n\n${draft}\n\n`
      + 'Assess problem clarity, traction evidence, number credibility, and narrative. Always finish by calling report_review.',
    one_pager_review:
      `${contextBlock(context)}\n\nReview this one-pager content, from an investor's point of view.\n\n${draft}\n\n`
      + 'Same lens as a deck review, adapted to a single page. Always finish by calling report_review.',
    market_data:
      `Market/sector benchmarking for our own company (the startup raising the round):\n${JSON.stringify(context, null, 2)}\n\n`
      + 'Using the company facts and sector above, give: 1) market size & growth direction for this specific sector, '
      + '2) where a company at this stage/traction typically sits vs peers, 3) the metrics investors in this space benchmark on, '
      + '4) comparable/adjacent companies worth knowing (only if you are confident). Mark anything you are not certain about '
      + 'as needing verification, and never invent specific figures.',
    business_plan_review:
      `${contextBlock(context)}\n\nReview this business plan, from a seed/pre-seed investor's point of view.\n\n${draft}\n\n`
      + 'What an investor actually checks here: does the stated strategy match the unit economics a financial plan would show '
      + '(they must not contradict each other); is the go-to-market sequence credible for the sector (not "we will scale" '
      + 'without saying how); does the competitive differentiation survive a direct question ("why doesn\'t an incumbent do '
      + 'this tomorrow") rather than reading as a feature list; clear awareness of regulatory risk/moat when the sector is '
      + 'regulated. Always finish by calling report_review.',
    financial_plan_review:
      `${contextBlock(context)}\n\nReview this financial plan, from an investor's point of view.\n\n${draft}\n\n`
      + 'What an investor actually checks here: burn rate vs runway honesty (does it match what is stated elsewhere); '
      + 'revenue assumptions traceable to named growth engines, not an unexplained top-down percentage; unit economics '
      + 'actually calculated (CAC/LTV or equivalent), not assumed; use of funds specific and tied to milestones, not generic '
      + '("growth", "team"); a simple read of cap table cleanliness (dilution, liquidation preferences). Always finish by calling report_review.',
    marketing_plan_review:
      `${contextBlock(context)}\n\nReview this commercial/marketing plan, from an investor's point of view.\n\n${draft}\n\n`
      + 'What an investor actually checks here: channel realism (not "we will go viral"); CAC assumptions anchored to sector '
      + 'comparables, not invented; honesty about sales-cycle length; evidence of conversion from partnerships/pilots already '
      + 'run, not just planned. Always finish by calling report_review.',
    cap_table_review:
      `${contextBlock(context)}\n\nQuick cap-table & terms read, from an investor's point of view — this is a lighter `
      + `mini-review, not a full document review.\n\n${draft}\n\n`
      + 'Is the round structured in a way an investor will find clean — reasonable dilution, no obvious red flags carried '
      + 'over from prior terms? Always finish by calling report_review.',
  };

  const structured = STRUCTURED_KINDS.includes(kind);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5',
        max_tokens: 1800,
        system: kind === 'message_review' ? messageReviewSystem : system,
        messages: [{ role: 'user', content: prompts[kind] ?? prompts.message_review }],
        ...(structured ? { tools: [REPORT_TOOL], tool_choice: { type: 'tool', name: 'report_review' } } : {}),
      }),
    });
    if (!res.ok) {
      console.error('AI review provider error:', (await res.text()).slice(0, 300));
      return NextResponse.json({ error: 'AI review failed — try again in a moment.' }, { status: 502 });
    }
    const data = await res.json();

    let review: string | undefined;
    let report: StructuredReport | undefined;
    if (structured) {
      const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
      report = toolUse?.input as StructuredReport | undefined;
      if (!report) return NextResponse.json({ error: 'AI review failed — try again in a moment.' }, { status: 502 });
    } else {
      review = (data.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    }

    // Persist every review (Prompt 99 §3.1 — ai_reviews existed with the
    // right schema but nothing ever inserted into it). Best-effort: a
    // logging failure must never fail the review the founder is looking at.
    if (url && service && member) {
      try {
        const admin = createClient(url, service, { auth: { persistSession: false } });
        await admin.from('ai_reviews').insert({
          org_id: member.org_id, kind, status: 'completed',
          result: structured ? report : { review },
          model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5',
          interaction_draft: kind === 'message_review' ? draft ?? null : null,
        });
      } catch (e) {
        console.error('ai_reviews insert failed:', e);
      }
    }

    return NextResponse.json(structured ? { report } : { review });
  } catch (e) {
    console.error('AI review error:', e);
    return NextResponse.json({ error: 'AI review failed — try again in a moment.' }, { status: 500 });
  }
}
